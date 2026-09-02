-- Second file so the new movement_type enum values from
-- 20260903000000_inventory_state_model.sql are committed before this
-- function body references them (Postgres won't let a new enum value be
-- used in the same transaction that added it).

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  qty_delta NUMERIC := 0;
  reserved_delta NUMERIC := 0;
  damaged_delta NUMERIC := 0;
  expired_delta NUMERIC := 0;
BEGIN
  CASE NEW.type
    WHEN 'reserve' THEN reserved_delta := NEW.quantity;
    WHEN 'unreserve' THEN reserved_delta := -NEW.quantity;
    WHEN 'damage' THEN damaged_delta := NEW.quantity;
    WHEN 'expired' THEN expired_delta := NEW.quantity;
    WHEN 'inbound', 'transfer_in', 'return', 'adjustment' THEN qty_delta := NEW.quantity;
    ELSE qty_delta := -NEW.quantity; -- outbound, transfer_out
  END CASE;

  INSERT INTO public.stock_levels (org_id, product_id, warehouse_id, quantity, reserved, damaged, expired)
  VALUES (NEW.org_id, NEW.product_id, NEW.warehouse_id, qty_delta, reserved_delta, damaged_delta, expired_delta)
  ON CONFLICT (product_id, warehouse_id)
  DO UPDATE SET
    quantity = public.stock_levels.quantity + qty_delta,
    reserved = public.stock_levels.reserved + reserved_delta,
    damaged = public.stock_levels.damaged + damaged_delta,
    expired = public.stock_levels.expired + expired_delta,
    updated_at = now();
  RETURN NEW;
END; $$;
