ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand TEXT;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS min_order_quantity NUMERIC(14,2);

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

CREATE OR REPLACE FUNCTION public.check_stock_alerts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _reorder_point NUMERIC;
  _product_name TEXT;
  _sku TEXT;
  _level_id UUID;
  _qty NUMERIC;
  _severity public.alert_severity;
  _title TEXT;
  _description TEXT;
  _recommended TEXT;
BEGIN
  SELECT reorder_point, name, sku INTO _reorder_point, _product_name, _sku
  FROM public.products WHERE id = NEW.product_id;

  IF _reorder_point IS NULL OR _reorder_point <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id, quantity INTO _level_id, _qty
  FROM public.stock_levels
  WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;

  IF _level_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF _qty > _reorder_point THEN
    UPDATE public.alerts
    SET status = 'resolved', resolved_at = now(), resolution = 'Stock replenished above reorder point'
    WHERE org_id = NEW.org_id AND entity_type = 'stock_level' AND entity_id = _level_id
      AND status IN ('open', 'acknowledged');
    RETURN NEW;
  END IF;

  IF _qty <= 0 THEN
    _severity := 'critical';
    _title := _product_name || ' is out of stock';
  ELSE
    _severity := 'warning';
    _title := _product_name || ' is below its reorder point';
  END IF;
  _description := format('%s units on hand (SKU %s). Reorder point is %s.', _qty, _sku, _reorder_point);
  _recommended := format('Create a purchase order for at least %s units.', GREATEST(_reorder_point - _qty, 0));

  UPDATE public.alerts
  SET severity = _severity, title = _title, description = _description,
      recommended_action = _recommended, updated_at = now()
  WHERE org_id = NEW.org_id AND entity_type = 'stock_level' AND entity_id = _level_id
    AND status IN ('open', 'acknowledged');

  IF NOT FOUND THEN
    INSERT INTO public.alerts (org_id, type, severity, title, description, entity_type, entity_id, recommended_action)
    VALUES (NEW.org_id, 'low_stock', _severity, _title, _description, 'stock_level', _level_id, _recommended);
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_stock_alerts() FROM PUBLIC;

CREATE TRIGGER trg_stock_movement_check_alerts AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.check_stock_alerts();

INSERT INTO public.alerts (org_id, type, severity, title, description, entity_type, entity_id, recommended_action)
SELECT
  sl.org_id,
  'low_stock',
  CASE WHEN sl.quantity <= 0 THEN 'critical' ELSE 'warning' END::public.alert_severity,
  p.name || (CASE WHEN sl.quantity <= 0 THEN ' is out of stock' ELSE ' is below its reorder point' END),
  format('%s units on hand (SKU %s). Reorder point is %s.', sl.quantity, p.sku, p.reorder_point),
  'stock_level',
  sl.id,
  format('Create a purchase order for at least %s units.', GREATEST(p.reorder_point - sl.quantity, 0))
FROM public.stock_levels sl
JOIN public.products p ON p.id = sl.product_id
WHERE p.reorder_point > 0
  AND sl.quantity <= p.reorder_point
  AND NOT EXISTS (
    SELECT 1 FROM public.alerts a
    WHERE a.entity_type = 'stock_level' AND a.entity_id = sl.id AND a.status IN ('open', 'acknowledged')
  );