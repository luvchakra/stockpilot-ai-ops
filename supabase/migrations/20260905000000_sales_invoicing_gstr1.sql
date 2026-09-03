-- Sales Invoicing + GSTR-1 Outward Supply (SP-5).
--
-- An invoice is generated from a confirmed/shipped/delivered sales order
-- (one invoice per order, enforced by a UNIQUE constraint on
-- sales_order_id) and snapshots its customer GSTIN/address and line
-- items (including each product's HSN code) at generation time -- the
-- same "snapshot, don't recompute later" pattern used for PO/SO line
-- items, so a later change to a customer's GSTIN or a product's HSN
-- code never rewrites a historical invoice.
--
-- Credit notes adjust an invoice's effective totals for GSTR-1 without
-- mutating the invoice row itself (append-only, like stock_movements).
-- A credit note always follows its parent invoice's CGST/SGST-vs-IGST
-- split (derived from which of the invoice's own tax columns is
-- populated) rather than re-resolving org/customer state, since GST
-- rules tie a credit note to its original invoice's place of supply.
--
-- Debit notes and proforma invoices get schema only in this migration --
-- no RPCs, no application code -- per the PRD's "schema-ready but no UI
-- yet".

CREATE TYPE public.invoice_payment_status AS ENUM ('unpaid', 'partial', 'paid');

CREATE TABLE public.sales_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL UNIQUE REFERENCES public.sales_orders(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_gstin TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_status public.invoice_payment_status NOT NULL DEFAULT 'unpaid',
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_number)
);

CREATE TABLE public.sales_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  hsn_code TEXT,
  quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id),
  credit_note_number TEXT NOT NULL,
  credit_note_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  is_full BOOLEAN NOT NULL DEFAULT false,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, credit_note_number)
);

-- Schema-ready only (PRD: "schema-ready but no UI yet") -- no RPCs, no
-- application code touches these two tables in this change.
CREATE TABLE public.debit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id),
  debit_note_number TEXT NOT NULL,
  debit_note_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, debit_note_number)
);

CREATE TABLE public.proforma_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id UUID REFERENCES public.sales_orders(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  proforma_number TEXT NOT NULL,
  proforma_date DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, proforma_number)
);

CREATE INDEX idx_invoices_org ON public.sales_invoices(org_id);
CREATE INDEX idx_invoices_customer ON public.sales_invoices(customer_id);
CREATE INDEX idx_invoices_date ON public.sales_invoices(org_id, invoice_date);
CREATE INDEX idx_invoice_items_invoice ON public.sales_invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_org ON public.sales_invoice_items(org_id);
CREATE INDEX idx_credit_notes_invoice ON public.credit_notes(sales_invoice_id);
CREATE INDEX idx_credit_notes_org ON public.credit_notes(org_id);

-- Grants + RLS, matching the hardened pattern (writes require staff+,
-- delete requires manager+, matching harden_tenant_rls.sql's end state).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_invoices', 'sales_invoice_items', 'credit_notes', 'debit_notes', 'proforma_invoices'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "org read" ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id))', t);
    EXECUTE format('CREATE POLICY "org write" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[]))', t);
    EXECUTE format('CREATE POLICY "org update" ON public.%I FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[]))', t);
    EXECUTE format('CREATE POLICY "org delete" ON public.%I FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'']::public.org_role[]))', t);
  END LOOP;
END $$;

CREATE TRIGGER trg_sales_invoices_updated BEFORE UPDATE ON public.sales_invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-financial-year sequential invoice/credit-note numbers
-- (INV/25-26/0001, CN/25-26/0001), same pattern as
-- next_sales_order_number: a dedicated counter table with no
-- client-facing policies, reachable only through these SECURITY DEFINER
-- functions.
CREATE TABLE public.sales_invoice_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, financial_year)
);
ALTER TABLE public.sales_invoice_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.credit_note_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, financial_year)
);
ALTER TABLE public.credit_note_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_sales_invoice_number(_org_id UUID)
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

  INSERT INTO public.sales_invoice_counters (org_id, financial_year, next_number)
  VALUES (_org_id, _fy, 2)
  ON CONFLICT (org_id, financial_year)
    DO UPDATE SET next_number = public.sales_invoice_counters.next_number + 1
  RETURNING next_number - 1 INTO _n;

  RETURN 'INV/' || _fy || '/' || lpad(_n::TEXT, 4, '0');
END; $$;
REVOKE ALL ON FUNCTION public.next_sales_invoice_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_sales_invoice_number(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.next_credit_note_number(_org_id UUID)
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

  INSERT INTO public.credit_note_counters (org_id, financial_year, next_number)
  VALUES (_org_id, _fy, 2)
  ON CONFLICT (org_id, financial_year)
    DO UPDATE SET next_number = public.credit_note_counters.next_number + 1
  RETURNING next_number - 1 INTO _n;

  RETURN 'CN/' || _fy || '/' || lpad(_n::TEXT, 4, '0');
END; $$;
REVOKE ALL ON FUNCTION public.next_credit_note_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_credit_note_number(UUID) TO authenticated;

-- Generate an invoice from a confirmed/shipped/delivered sales order.
-- Not SECURITY DEFINER -- runs as the calling user, so ordinary RLS on
-- sales_invoices/sales_invoice_items still applies (staff+ required to
-- actually persist anything), same pattern as confirm_sales_order.
CREATE OR REPLACE FUNCTION public.generate_sales_invoice(_so_id UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _so public.sales_orders%ROWTYPE;
  _customer public.customers%ROWTYPE;
  _invoice_id UUID;
  _invoice_number TEXT;
BEGIN
  SELECT * INTO _so FROM public.sales_orders WHERE id = _so_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;
  IF _so.status NOT IN ('confirmed', 'processing', 'packed', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'An invoice can only be generated from a confirmed or shipped sales order';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_invoices WHERE sales_order_id = _so_id) THEN
    RAISE EXCEPTION 'An invoice already exists for this sales order';
  END IF;

  SELECT * INTO _customer FROM public.customers WHERE id = _so.customer_id;

  _invoice_number := public.next_sales_invoice_number(_so.org_id);

  INSERT INTO public.sales_invoices (
    org_id, sales_order_id, customer_id, invoice_number, customer_gstin,
    billing_address, shipping_address, subtotal, discount_amount,
    cgst_amount, sgst_amount, igst_amount, shipping_amount, total_amount
  ) VALUES (
    _so.org_id, _so.id, _so.customer_id, _invoice_number, _customer.gstin,
    _customer.billing_address, coalesce(_customer.shipping_address, _customer.billing_address),
    _so.subtotal, _so.discount_amount,
    _so.cgst_amount, _so.sgst_amount, _so.igst_amount, _so.shipping_amount, _so.total_amount
  ) RETURNING id INTO _invoice_id;

  INSERT INTO public.sales_invoice_items (
    org_id, invoice_id, product_id, hsn_code, quantity, unit_price, tax_rate,
    cgst_amount, sgst_amount, igst_amount
  )
  SELECT soi.org_id, _invoice_id, soi.product_id, p.hsn_code, soi.quantity, soi.unit_price, soi.tax_rate,
         soi.cgst_amount, soi.sgst_amount, soi.igst_amount
  FROM public.sales_order_items soi
  JOIN public.products p ON p.id = soi.product_id
  WHERE soi.sales_order_id = _so_id;

  RETURN _invoice_id;
END; $$;
REVOKE ALL ON FUNCTION public.generate_sales_invoice(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_sales_invoice(UUID) TO authenticated;

-- Create a credit note against an invoice, full or partial. A full
-- credit note reverses exactly whatever taxable value/tax remains
-- uncredited; a partial one takes an explicit taxable value and derives
-- its CGST/SGST/IGST as that value's proportional share of the
-- invoice's own tax (credited_tax = invoice_tax * credited_subtotal /
-- invoice_subtotal), rather than letting the caller pick an independent
-- GST rate. That proportional split, not a caller-supplied rate, is
-- what guarantees a run of partial credits can never leave a later full
-- credit needing to reverse more tax than the invoice ever charged.
-- Not SECURITY DEFINER, for the same reason as generate_sales_invoice.
CREATE OR REPLACE FUNCTION public.create_credit_note(
  _invoice_id UUID,
  _is_full BOOLEAN,
  _subtotal NUMERIC DEFAULT NULL,
  _reason TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _invoice public.sales_invoices%ROWTYPE;
  _credited_subtotal NUMERIC;
  _credited_cgst NUMERIC;
  _credited_sgst NUMERIC;
  _credited_igst NUMERIC;
  _remaining_subtotal NUMERIC;
  _ratio NUMERIC;
  _cn_subtotal NUMERIC;
  _cn_cgst NUMERIC := 0;
  _cn_sgst NUMERIC := 0;
  _cn_igst NUMERIC := 0;
  _cn_id UUID;
  _cn_number TEXT;
BEGIN
  SELECT * INTO _invoice FROM public.sales_invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  SELECT coalesce(sum(subtotal), 0), coalesce(sum(cgst_amount), 0),
         coalesce(sum(sgst_amount), 0), coalesce(sum(igst_amount), 0)
  INTO _credited_subtotal, _credited_cgst, _credited_sgst, _credited_igst
  FROM public.credit_notes WHERE sales_invoice_id = _invoice_id;

  _remaining_subtotal := _invoice.subtotal - _credited_subtotal;
  IF _remaining_subtotal <= 0 THEN
    RAISE EXCEPTION 'This invoice has already been fully credited';
  END IF;

  IF _is_full THEN
    _cn_subtotal := _remaining_subtotal;
    _cn_cgst := _invoice.cgst_amount - _credited_cgst;
    _cn_sgst := _invoice.sgst_amount - _credited_sgst;
    _cn_igst := _invoice.igst_amount - _credited_igst;
  ELSE
    IF _subtotal IS NULL OR _subtotal <= 0 THEN
      RAISE EXCEPTION 'Enter a credit amount greater than zero';
    END IF;
    IF _subtotal > _remaining_subtotal THEN
      RAISE EXCEPTION 'Cannot credit more than the remaining invoice value (%)', _remaining_subtotal;
    END IF;

    _cn_subtotal := _subtotal;
    _ratio := CASE WHEN _invoice.subtotal > 0 THEN _subtotal / _invoice.subtotal ELSE 0 END;
    _cn_cgst := round(_invoice.cgst_amount * _ratio, 2);
    _cn_sgst := round(_invoice.sgst_amount * _ratio, 2);
    _cn_igst := round(_invoice.igst_amount * _ratio, 2);
  END IF;

  _cn_number := public.next_credit_note_number(_invoice.org_id);

  INSERT INTO public.credit_notes (
    org_id, sales_invoice_id, credit_note_number, reason, is_full,
    subtotal, cgst_amount, sgst_amount, igst_amount, total_amount
  ) VALUES (
    _invoice.org_id, _invoice_id, _cn_number, _reason, _is_full,
    _cn_subtotal, _cn_cgst, _cn_sgst, _cn_igst, _cn_subtotal + _cn_cgst + _cn_sgst + _cn_igst
  ) RETURNING id INTO _cn_id;

  RETURN _cn_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_credit_note(UUID, BOOLEAN, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_credit_note(UUID, BOOLEAN, NUMERIC, TEXT) TO authenticated;
