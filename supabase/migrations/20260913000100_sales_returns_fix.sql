-- Fix a bug in approve_sales_return() found by the RLS test suite: a CASE
-- expression between two string literals ('damage'/'return') resolves to
-- `text`, and Postgres only implicitly casts an unknown-typed literal to a
-- custom enum -- not a `text`-typed expression -- so the stock_movements
-- insert failed with "column \"type\" is of type movement_type but
-- expression is of type text" on every approval. An explicit cast to
-- movement_type fixes it.
CREATE OR REPLACE FUNCTION public.approve_sales_return(_return_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _return public.sales_returns%ROWTYPE;
  _so public.sales_orders%ROWTYPE;
  _item RECORD;
  _so_qty NUMERIC;
  _already_returned NUMERIC;
  _return_total NUMERIC := 0;
  _invoice_remaining NUMERIC;
  _is_full BOOLEAN;
  _cn_id UUID;
BEGIN
  IF NOT public.is_org_member((SELECT org_id FROM public.sales_returns WHERE id = _return_id)) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  SELECT * INTO _return FROM public.sales_returns WHERE id = _return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales return not found';
  END IF;
  IF NOT public.has_permission(_return.org_id, 'sales_returns.approve') THEN
    RAISE EXCEPTION 'Missing sales_returns.approve permission';
  END IF;
  IF _return.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft return can be approved';
  END IF;
  IF _return.sales_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Generate the sales invoice for this order before approving a return against it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_return_items WHERE sales_return_id = _return_id) THEN
    RAISE EXCEPTION 'Add at least one line item before approving this return';
  END IF;

  SELECT * INTO _so FROM public.sales_orders WHERE id = _return.sales_order_id;

  FOR _item IN
    SELECT ri.product_id, ri.quantity, ri.unit_price, ri.restock, ri.is_damaged, p.name, p.sku
    FROM public.sales_return_items ri
    JOIN public.products p ON p.id = ri.product_id
    WHERE ri.sales_return_id = _return_id
  LOOP
    SELECT COALESCE(sum(soi.quantity), 0) INTO _so_qty
    FROM public.sales_order_items soi
    WHERE soi.sales_order_id = _so.id AND soi.product_id = _item.product_id;

    SELECT COALESCE(sum(ri2.quantity), 0) INTO _already_returned
    FROM public.sales_return_items ri2
    JOIN public.sales_returns r2 ON r2.id = ri2.sales_return_id
    WHERE r2.sales_order_id = _so.id AND ri2.product_id = _item.product_id
      AND r2.id <> _return_id AND r2.status IN ('approved', 'completed');

    IF _already_returned + _item.quantity > _so_qty THEN
      RAISE EXCEPTION 'Cannot return more than was sold for % (%): sold %, already returned %',
        _item.name, _item.sku, _so_qty, _already_returned;
    END IF;

    IF _item.restock THEN
      INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
      VALUES (
        _return.org_id, _item.product_id, _so.warehouse_id,
        (CASE WHEN _item.is_damaged THEN 'damage' ELSE 'return' END)::public.movement_type,
        _item.quantity, _return.return_number,
        CASE WHEN _item.is_damaged THEN 'Returned damaged against sales return' ELSE 'Restocked against sales return' END,
        auth.uid()
      );
    END IF;

    _return_total := _return_total + _item.quantity * _item.unit_price;
  END LOOP;

  SELECT si.subtotal - COALESCE(
    (SELECT sum(subtotal) FROM public.credit_notes WHERE sales_invoice_id = si.id), 0
  ) INTO _invoice_remaining
  FROM public.sales_invoices si WHERE si.id = _return.sales_invoice_id;

  _is_full := _return_total >= _invoice_remaining;

  _cn_id := public.create_credit_note(
    _return.sales_invoice_id,
    _is_full,
    CASE WHEN _is_full THEN NULL ELSE _return_total END,
    'Sales return ' || _return.return_number
  );
  UPDATE public.credit_notes SET sales_return_id = _return_id WHERE id = _cn_id;

  UPDATE public.sales_returns
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), credit_note_id = _cn_id
  WHERE id = _return_id;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_sales_return(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_sales_return(UUID) TO authenticated;
