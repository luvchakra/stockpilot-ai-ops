-- Sales Orders + Customers (SP-4). Mirrors the Purchase Orders pattern
-- (stage stepper, GST computation via the existing lib/gst.ts engine,
-- draft-only editing) with the org as the GST seller and the customer as
-- the buyer — the reverse of Purchase Orders.
--
-- Status workflow: draft -> confirmed -> processing -> packed -> shipped
-- -> delivered, with cancelled/returned as terminal side branches.
-- Confirming reserves stock (RESERVE movements, all-or-nothing — no line
-- gets partially reserved); shipping posts the real stock-out and releases
-- the reservation; cancelling before shipment releases the reservation
-- with no stock-out. These three transitions run as functions rather than
-- plain client updates so the reservation check and the movement inserts
-- are atomic, and — since none of them are SECURITY DEFINER — ordinary
-- RLS still applies to every write inside them (same pattern as
-- receive_purchase_order_item): a viewer-role user's confirm/ship/cancel
-- attempt fails at the stock_movements/sales_orders write, not because of
-- a bespoke role check here.

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gstin TEXT,
  phone TEXT,
  email TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  state TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_org ON public.customers(org_id);

CREATE TYPE public.so_status AS ENUM (
  'draft',
  'confirmed',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'returned'
);

CREATE TABLE public.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  so_number TEXT NOT NULL,
  status public.so_status NOT NULL DEFAULT 'draft',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_fulfillment_date DATE,
  notes TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, so_number)
);

CREATE TABLE public.sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_so_org ON public.sales_orders(org_id);
CREATE INDEX idx_so_customer ON public.sales_orders(customer_id);
CREATE INDEX idx_so_items_so ON public.sales_order_items(sales_order_id);
CREATE INDEX idx_so_items_org ON public.sales_order_items(org_id);

-- Grants + RLS, matching the hardened pattern (writes require staff+,
-- delete requires manager+, matching harden_tenant_rls.sql's end state).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'sales_orders', 'sales_order_items'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "org read" ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id))', t);
    EXECUTE format('CREATE POLICY "org write" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[]))', t);
    EXECUTE format('CREATE POLICY "org update" ON public.%I FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[]))', t);
    EXECUTE format('CREATE POLICY "org delete" ON public.%I FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'']::public.org_role[]))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['customers', 'sales_orders'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

-- Per-financial-year sequential order numbers (e.g. SO/25-26/0001). The
-- counter table has no client-facing policies at all — only this
-- SECURITY DEFINER function touches it — so the atomic upsert below is
-- the sole path to a number, safe under concurrent order creation.
CREATE TABLE public.sales_order_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, financial_year)
);
ALTER TABLE public.sales_order_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_sales_order_number(_org_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _fy TEXT;
  _n INTEGER;
  _today DATE := CURRENT_DATE;
BEGIN
  IF NOT public.is_org_member(_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  IF EXTRACT(MONTH FROM _today) >= 4 THEN
    _fy := to_char(_today, 'YY') || '-' || to_char(_today + INTERVAL '1 year', 'YY');
  ELSE
    _fy := to_char(_today - INTERVAL '1 year', 'YY') || '-' || to_char(_today, 'YY');
  END IF;

  INSERT INTO public.sales_order_counters (org_id, financial_year, next_number)
  VALUES (_org_id, _fy, 2)
  ON CONFLICT (org_id, financial_year)
    DO UPDATE SET next_number = public.sales_order_counters.next_number + 1
  RETURNING next_number - 1 INTO _n;

  RETURN 'SO/' || _fy || '/' || lpad(_n::TEXT, 4, '0');
END; $$;
REVOKE ALL ON FUNCTION public.next_sales_order_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_sales_order_number(UUID) TO authenticated;

-- Draft -> Confirmed: reserve every line item's quantity, all-or-nothing.
CREATE OR REPLACE FUNCTION public.confirm_sales_order(_so_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _so public.sales_orders%ROWTYPE;
  _item RECORD;
  _available NUMERIC;
  _short TEXT := '';
BEGIN
  SELECT * INTO _so FROM public.sales_orders WHERE id = _so_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;
  IF _so.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft order can be confirmed';
  END IF;

  FOR _item IN
    SELECT soi.product_id, soi.quantity, p.name, p.sku
    FROM public.sales_order_items soi
    JOIN public.products p ON p.id = soi.product_id
    WHERE soi.sales_order_id = _so_id
  LOOP
    SELECT COALESCE(sl.quantity, 0) - COALESCE(sl.reserved, 0) - COALESCE(sl.damaged, 0) - COALESCE(sl.expired, 0)
    INTO _available
    FROM public.stock_levels sl
    WHERE sl.product_id = _item.product_id AND sl.warehouse_id = _so.warehouse_id;

    IF COALESCE(_available, 0) < _item.quantity THEN
      _short := _short || CASE WHEN _short = '' THEN '' ELSE '; ' END
        || _item.name || ' (' || _item.sku || '): need ' || _item.quantity
        || ', have ' || COALESCE(_available, 0) || ' available';
    END IF;
  END LOOP;

  IF _short <> '' THEN
    RAISE EXCEPTION 'Not enough available stock — %', _short;
  END IF;

  INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
  SELECT _so.org_id, soi.product_id, _so.warehouse_id, 'reserve', soi.quantity, _so.so_number,
         'Reserved on sales order confirmation', auth.uid()
  FROM public.sales_order_items soi
  WHERE soi.sales_order_id = _so_id;

  UPDATE public.sales_orders SET status = 'confirmed' WHERE id = _so_id;
END; $$;
REVOKE ALL ON FUNCTION public.confirm_sales_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_sales_order(UUID) TO authenticated;

-- -> Shipped: real stock-out, and release the reservation so on_hand only
-- drops when stock actually leaves.
CREATE OR REPLACE FUNCTION public.ship_sales_order(_so_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _so public.sales_orders%ROWTYPE;
BEGIN
  SELECT * INTO _so FROM public.sales_orders WHERE id = _so_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;
  IF _so.status NOT IN ('confirmed', 'processing', 'packed') THEN
    RAISE EXCEPTION 'Order must be confirmed before it can be shipped';
  END IF;

  INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
  SELECT _so.org_id, soi.product_id, _so.warehouse_id, 'outbound', soi.quantity, _so.so_number,
         'Shipped against sales order', auth.uid()
  FROM public.sales_order_items soi
  WHERE soi.sales_order_id = _so_id;

  INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
  SELECT _so.org_id, soi.product_id, _so.warehouse_id, 'unreserve', soi.quantity, _so.so_number,
         'Reservation released on shipment', auth.uid()
  FROM public.sales_order_items soi
  WHERE soi.sales_order_id = _so_id;

  UPDATE public.sales_orders SET status = 'shipped' WHERE id = _so_id;
END; $$;
REVOKE ALL ON FUNCTION public.ship_sales_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ship_sales_order(UUID) TO authenticated;

-- Cancel: release any reservation with no stock-out. A draft never
-- reserved anything, so it's just a status flip; a shipped/delivered
-- order has already left the warehouse and can't be cancelled here.
CREATE OR REPLACE FUNCTION public.cancel_sales_order(_so_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _so public.sales_orders%ROWTYPE;
BEGIN
  SELECT * INTO _so FROM public.sales_orders WHERE id = _so_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;
  IF _so.status IN ('shipped', 'delivered', 'cancelled', 'returned') THEN
    RAISE EXCEPTION 'An order that has already shipped cannot be cancelled';
  END IF;

  IF _so.status <> 'draft' THEN
    INSERT INTO public.stock_movements (org_id, product_id, warehouse_id, type, quantity, reference, notes, created_by)
    SELECT _so.org_id, soi.product_id, _so.warehouse_id, 'unreserve', soi.quantity, _so.so_number,
           'Reservation released on cancellation', auth.uid()
    FROM public.sales_order_items soi
    WHERE soi.sales_order_id = _so_id;
  END IF;

  UPDATE public.sales_orders SET status = 'cancelled' WHERE id = _so_id;
END; $$;
REVOKE ALL ON FUNCTION public.cancel_sales_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_sales_order(UUID) TO authenticated;
