-- Purchase Orders & Receiving (PRD sections 28-30).
--
-- Workflow: draft -> pending_approval -> approved -> sent
--   -> partially_received / received -> closed (or cancelled at any
--   point before receiving starts).
--
-- Receiving is done through the receive_purchase_order_item() function
-- rather than raw client-side writes, so that recording a received
-- quantity, posting the stock movement, and rolling the PO's overall
-- status forward always happen together as one transaction.

CREATE TYPE public.po_status AS ENUM (
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled'
);

CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  po_number TEXT NOT NULL,
  status public.po_status NOT NULL DEFAULT 'draft',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  notes TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, po_number)
);

CREATE TABLE public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  received_quantity NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_org ON public.purchase_orders(org_id);
CREATE INDEX idx_po_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX idx_po_items_po ON public.purchase_order_items(purchase_order_id);
CREATE INDEX idx_po_items_org ON public.purchase_order_items(org_id);

-- Grants + RLS, matching the hardened pattern from the tenant RLS
-- migration: writes require staff or above, not just any org member.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders','purchase_order_items'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "org read" ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id))', t);
    EXECUTE format('CREATE POLICY "org write" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[]))', t);
    EXECUTE format('CREATE POLICY "org update" ON public.%I FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[]))', t);
    EXECUTE format('CREATE POLICY "org delete" ON public.%I FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'']::public.org_role[]))', t);
  END LOOP;
END $$;

CREATE TRIGGER trg_purchase_orders_updated BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Receive a quantity against one PO line item: posts the inbound stock
-- movement and rolls the PO's status forward, atomically. Not
-- SECURITY DEFINER — it runs as the calling user, so the normal RLS
-- writes above still apply (the caller must be staff+ in the PO's org
-- to insert/update these rows, same as any direct write would require).
CREATE OR REPLACE FUNCTION public.receive_purchase_order_item(_item_id UUID, _quantity NUMERIC)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _item public.purchase_order_items%ROWTYPE;
  _po public.purchase_orders%ROWTYPE;
  _total_ordered NUMERIC;
  _total_received NUMERIC;
BEGIN
  SELECT * INTO _item FROM public.purchase_order_items WHERE id = _item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order item not found';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  IF _item.received_quantity + _quantity > _item.quantity THEN
    RAISE EXCEPTION 'Cannot receive more than the ordered quantity';
  END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = _item.purchase_order_id;
  IF _po.status NOT IN ('sent', 'approved', 'partially_received') THEN
    RAISE EXCEPTION 'Purchase order must be approved and sent before it can be received';
  END IF;

  INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
  VALUES (_po.org_id, _item.product_id, _po.warehouse_id, 'inbound', _quantity, _po.po_number, 'Received against purchase order', auth.uid());

  UPDATE public.purchase_order_items
  SET received_quantity = received_quantity + _quantity
  WHERE id = _item_id;

  SELECT sum(quantity), sum(received_quantity) INTO _total_ordered, _total_received
  FROM public.purchase_order_items WHERE purchase_order_id = _po.id;

  UPDATE public.purchase_orders
  SET status = CASE WHEN _total_received >= _total_ordered THEN 'received' ELSE 'partially_received' END::public.po_status
  WHERE id = _po.id;
END;
$$;
REVOKE ALL ON FUNCTION public.receive_purchase_order_item(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_item(UUID, NUMERIC) TO authenticated;
