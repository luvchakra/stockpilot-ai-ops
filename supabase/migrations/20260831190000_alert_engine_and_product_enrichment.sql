-- Enrichment pass against the original PRD for features that were already
-- implemented but incomplete relative to spec:
--
--  1. Alert engine (PRD "ALERT ENGINE"): the alerts table + UI existed, but
--     nothing ever inserted a row into it. Add a reactive low-stock/
--     stockout alert generator, triggered off the same stock_movements
--     ledger that already drives stock_levels, plus a one-time backfill so
--     any already-low stock shows up immediately rather than only after
--     the next movement.
--  2. Product master (PRD section 16): add brand — barcode, description
--     and image_url already existed on the table but were never exposed
--     in the Products page UI, so those just needed frontend work, not a
--     migration.
--  3. Procurement (PRD section 28): add minimum order quantity to
--     suppliers — address, city, state and rating already existed on the
--     table but, like the products fields above, were never exposed in
--     the Suppliers page UI.
--  4. Multi-warehouse (PRD section 22): add PIN code and a contact
--     name/phone to warehouses, called out in the PRD's warehouse fields.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand TEXT;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS min_order_quantity NUMERIC(14,2);

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- One low-stock/stockout alert per stock_levels row, kept live: opened when
-- stock first drops to/under the product's reorder point, updated in place
-- while it stays low, and auto-resolved once it recovers. Not
-- SECURITY DEFINER-restricted to a role check because it's a side effect of
-- a stock movement the caller was already authorized (by RLS) to post, not
-- a new privilege of its own.
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
    -- Back above the threshold: auto-resolve any open alert for this level.
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

-- Name sorts after "on_stock_movement" (which syncs stock_levels), so this
-- always sees the post-movement quantity.
CREATE TRIGGER trg_stock_movement_check_alerts AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.check_stock_alerts();

-- Backfill: alert on stock that was already low before this trigger existed.
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
