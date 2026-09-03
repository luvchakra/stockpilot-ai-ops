-- Second file so the new movement_type enum values from
-- 20260910000000_stock_transfers.sql are committed before this function
-- body references them (Postgres won't let a new enum value be used in
-- the same transaction that added it) -- same two-file split as SP-3's
-- inventory state model.

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  qty_delta NUMERIC := 0;
  reserved_delta NUMERIC := 0;
  damaged_delta NUMERIC := 0;
  expired_delta NUMERIC := 0;
  in_transit_delta NUMERIC := 0;
BEGIN
  CASE NEW.type
    WHEN 'reserve' THEN reserved_delta := NEW.quantity;
    WHEN 'unreserve' THEN reserved_delta := -NEW.quantity;
    WHEN 'damage' THEN damaged_delta := NEW.quantity;
    WHEN 'expired' THEN expired_delta := NEW.quantity;
    -- Stock transfers (SP-9): xfer_ship/xfer_cancel_ship post against the
    -- source warehouse's row, xfer_arrive/xfer_receive*/xfer_cancel_arrive
    -- against the destination's -- the RPCs in this migration insert each
    -- half of a transition against the correct warehouse.
    WHEN 'xfer_ship' THEN qty_delta := -NEW.quantity;
    WHEN 'xfer_cancel_ship' THEN qty_delta := NEW.quantity;
    WHEN 'xfer_arrive' THEN in_transit_delta := NEW.quantity;
    WHEN 'xfer_cancel_arrive' THEN in_transit_delta := -NEW.quantity;
    WHEN 'xfer_receive' THEN
      qty_delta := NEW.quantity;
      in_transit_delta := -NEW.quantity;
    WHEN 'xfer_receive_damaged' THEN
      damaged_delta := NEW.quantity;
      in_transit_delta := -NEW.quantity;
    WHEN 'inbound', 'transfer_in', 'return', 'adjustment' THEN qty_delta := NEW.quantity;
    ELSE qty_delta := -NEW.quantity; -- outbound, transfer_out
  END CASE;

  INSERT INTO public.stock_levels (org_id, product_id, warehouse_id, quantity, reserved, damaged, expired, in_transit)
  VALUES (NEW.org_id, NEW.product_id, NEW.warehouse_id, qty_delta, reserved_delta, damaged_delta, expired_delta, in_transit_delta)
  ON CONFLICT (product_id, warehouse_id)
  DO UPDATE SET
    quantity = public.stock_levels.quantity + qty_delta,
    reserved = public.stock_levels.reserved + reserved_delta,
    damaged = public.stock_levels.damaged + damaged_delta,
    expired = public.stock_levels.expired + expired_delta,
    in_transit = public.stock_levels.in_transit + in_transit_delta,
    updated_at = now();
  RETURN NEW;
END; $$;

-- Approved -> In Transit: checks every line against the source warehouse's
-- available stock (all-or-nothing, same as confirm_sales_order), then
-- posts the ship-out/arrive-pending pair for every line. Not SECURITY
-- DEFINER: runs as the calling user, so the stock_transfers.approve
-- permission check on the RLS policies above still applies.
CREATE OR REPLACE FUNCTION public.ship_stock_transfer(_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _transfer public.stock_transfers%ROWTYPE;
  _short RECORD;
BEGIN
  SELECT * INTO _transfer FROM public.stock_transfers WHERE id = _transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer not found';
  END IF;
  IF _transfer.status <> 'approved' THEN
    RAISE EXCEPTION 'Stock transfer must be approved before it can be shipped';
  END IF;

  SELECT i.product_id, p.sku, i.quantity, COALESCE(l.quantity - l.reserved - l.damaged - l.expired, 0) AS available
  INTO _short
  FROM public.stock_transfer_items i
  JOIN public.products p ON p.id = i.product_id
  LEFT JOIN public.stock_levels l ON l.product_id = i.product_id AND l.warehouse_id = _transfer.source_warehouse_id
  WHERE i.stock_transfer_id = _transfer_id
    AND i.quantity > COALESCE(l.quantity - l.reserved - l.damaged - l.expired, 0)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Not enough available stock for %: need %, have %', _short.sku, _short.quantity, _short.available;
  END IF;

  INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
  SELECT _transfer.org_id, i.product_id, _transfer.source_warehouse_id, 'xfer_ship', i.quantity,
    _transfer.transfer_number, 'Shipped on stock transfer', auth.uid()
  FROM public.stock_transfer_items i WHERE i.stock_transfer_id = _transfer_id;

  INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
  SELECT _transfer.org_id, i.product_id, _transfer.destination_warehouse_id, 'xfer_arrive', i.quantity,
    _transfer.transfer_number, 'In transit on stock transfer', auth.uid()
  FROM public.stock_transfer_items i WHERE i.stock_transfer_id = _transfer_id;

  UPDATE public.stock_transfers SET status = 'in_transit', shipped_at = now() WHERE id = _transfer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ship_stock_transfer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ship_stock_transfer(UUID) TO authenticated;

-- Receive a quantity against one transfer line item, split into a good
-- portion and a damaged portion (the damaged path routes to the
-- destination's `damaged` state instead of on_hand). Rolls the transfer's
-- status to 'received' once every line is fully accounted for.
CREATE OR REPLACE FUNCTION public.receive_stock_transfer_item(_item_id UUID, _quantity NUMERIC, _damaged_quantity NUMERIC DEFAULT 0)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _item public.stock_transfer_items%ROWTYPE;
  _transfer public.stock_transfers%ROWTYPE;
  _total_qty NUMERIC;
  _total_accounted NUMERIC;
BEGIN
  SELECT * INTO _item FROM public.stock_transfer_items WHERE id = _item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer item not found';
  END IF;
  IF COALESCE(_quantity, 0) <= 0 AND COALESCE(_damaged_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Received and/or damaged quantity must be positive';
  END IF;
  IF _item.received_quantity + _item.damaged_quantity + COALESCE(_quantity, 0) + COALESCE(_damaged_quantity, 0) > _item.quantity THEN
    RAISE EXCEPTION 'Cannot receive more than the shipped quantity';
  END IF;

  SELECT * INTO _transfer FROM public.stock_transfers WHERE id = _item.stock_transfer_id;
  IF _transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Stock transfer must be in transit before it can be received';
  END IF;

  IF COALESCE(_quantity, 0) > 0 THEN
    INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
    VALUES (_transfer.org_id, _item.product_id, _transfer.destination_warehouse_id, 'xfer_receive', _quantity,
      _transfer.transfer_number, 'Received against stock transfer', auth.uid());
  END IF;
  IF COALESCE(_damaged_quantity, 0) > 0 THEN
    INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
    VALUES (_transfer.org_id, _item.product_id, _transfer.destination_warehouse_id, 'xfer_receive_damaged', _damaged_quantity,
      _transfer.transfer_number, 'Received damaged against stock transfer', auth.uid());
  END IF;

  UPDATE public.stock_transfer_items
  SET received_quantity = received_quantity + COALESCE(_quantity, 0),
      damaged_quantity = damaged_quantity + COALESCE(_damaged_quantity, 0)
  WHERE id = _item_id;

  SELECT sum(quantity), sum(received_quantity + damaged_quantity) INTO _total_qty, _total_accounted
  FROM public.stock_transfer_items WHERE stock_transfer_id = _transfer.id;

  IF _total_accounted >= _total_qty THEN
    UPDATE public.stock_transfers SET status = 'received', received_at = now() WHERE id = _transfer.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.receive_stock_transfer_item(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer_item(UUID, NUMERIC, NUMERIC) TO authenticated;

-- Cancel a transfer. Before shipping, this is a pure status flip (nothing
-- has touched stock yet). While in transit, reverses only the remaining
-- unreceived quantity per line -- a transfer partially received before
-- being cancelled keeps what already landed at the destination.
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(_transfer_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _transfer public.stock_transfers%ROWTYPE;
BEGIN
  SELECT * INTO _transfer FROM public.stock_transfers WHERE id = _transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer not found';
  END IF;
  IF _transfer.status IN ('received', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'This stock transfer can no longer be cancelled';
  END IF;

  IF _transfer.status = 'in_transit' THEN
    INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
    SELECT _transfer.org_id, i.product_id, _transfer.source_warehouse_id, 'xfer_cancel_ship',
      i.quantity - i.received_quantity - i.damaged_quantity, _transfer.transfer_number,
      'Stock transfer cancelled in transit', auth.uid()
    FROM public.stock_transfer_items i
    WHERE i.stock_transfer_id = _transfer_id AND i.quantity - i.received_quantity - i.damaged_quantity > 0;

    INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
    SELECT _transfer.org_id, i.product_id, _transfer.destination_warehouse_id, 'xfer_cancel_arrive',
      i.quantity - i.received_quantity - i.damaged_quantity, _transfer.transfer_number,
      'Stock transfer cancelled in transit', auth.uid()
    FROM public.stock_transfer_items i
    WHERE i.stock_transfer_id = _transfer_id AND i.quantity - i.received_quantity - i.damaged_quantity > 0;
  END IF;

  UPDATE public.stock_transfers SET status = 'cancelled', cancelled_at = now() WHERE id = _transfer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_stock_transfer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(UUID) TO authenticated;
