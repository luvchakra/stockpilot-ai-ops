-- Sales Returns / RMA (SP-11).
--
-- Persona: a sales manager processes a customer return (damaged, wrong
-- item, changed mind), decides restock vs. credit-only per line, and
-- issues a credit note for the returned value against the original
-- invoice -- reusing create_credit_note from SP-5 rather than
-- duplicating its full/partial tax-split logic.
--
-- Workflow: draft -> approved -> completed, with cancelled as a side
-- branch reachable only from draft (nothing has touched stock or issued
-- a credit note yet at that point, so cancelling needs no reversal
-- logic). All of the return's real-world effects -- the restock/damage
-- stock movement per line and the credit note itself -- happen on the
-- draft->approved transition, per the ticket ("On Approving a restock
-- line: post a stock-in movement..."). Completing is a pure close-out
-- step with no further side effects, same role as a purchase order's
-- terminal "closed" status.
--
-- No new movement_type values are needed: 'return' already routes into
-- on_hand and 'damage' into the damaged bucket (see
-- apply_stock_movement's CASE, added by SP-3/SP-9), which is exactly
-- the good-condition/damaged-condition split this feature needs.

CREATE TYPE public.sales_return_status AS ENUM ('draft', 'approved', 'completed', 'cancelled');

CREATE TYPE public.sales_return_reason AS ENUM (
  'wrong_item', 'damaged', 'changed_mind', 'size_issue', 'quality_issue', 'other'
);

CREATE TABLE public.sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id),
  -- Resolved server-side from sales_order_id (see the trigger below),
  -- never trusted from the client -- a return can be drafted before an
  -- invoice exists for the order, so this stays null until one does.
  sales_invoice_id UUID REFERENCES public.sales_invoices(id),
  -- Populated once approve_sales_return() issues the credit note.
  credit_note_id UUID REFERENCES public.credit_notes(id),
  return_number TEXT NOT NULL,
  status public.sales_return_status NOT NULL DEFAULT 'draft',
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  requested_by UUID NOT NULL DEFAULT auth.uid(),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, return_number)
);

CREATE TABLE public.sales_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  -- Snapshot from the sales order line at draft time, same "snapshot,
  -- don't recompute later" rule PO/SO/invoice line items already
  -- follow -- this is what the credit note's value is computed from.
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason public.sales_return_reason NOT NULL DEFAULT 'other',
  -- true: goods come back into inventory (good or damaged, see
  -- is_damaged); false: credit-only, no stock movement at all.
  restock BOOLEAN NOT NULL DEFAULT true,
  -- Only meaningful when restock is true: routes the stock-in to the
  -- damaged bucket instead of on_hand.
  is_damaged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Traceability from the credit-note side ("this credit note was issued
-- for that return") -- sales_returns.credit_note_id above covers the
-- reverse direction from the return's own detail view.
ALTER TABLE public.credit_notes ADD COLUMN sales_return_id UUID REFERENCES public.sales_returns(id);
CREATE INDEX idx_credit_notes_sales_return ON public.credit_notes(sales_return_id);

CREATE INDEX idx_sales_returns_org ON public.sales_returns(org_id);
CREATE INDEX idx_sales_returns_so ON public.sales_returns(sales_order_id);
CREATE INDEX idx_sales_return_items_return ON public.sales_return_items(sales_return_id);
CREATE INDEX idx_sales_return_items_org ON public.sales_return_items(org_id);

CREATE TRIGGER trg_sales_returns_updated BEFORE UPDATE ON public.sales_returns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Permission catalog. sales_returns.approve is granted to sales_manager
-- (the ticket's persona) even though issuing a credit note directly
-- from Sales Invoices requires invoices.cancel, which sales_manager
-- deliberately doesn't have -- see approve_sales_return()'s comment for
-- why that's safe.
INSERT INTO public.permissions (key, module, description) VALUES
  ('sales_returns.create', 'sales_returns', 'Create/update draft sales returns (RMAs)'),
  ('sales_returns.approve', 'sales_returns', 'Approve a sales return: post its restock/damaged stock movement and issue its credit note'),
  ('sales_returns.cancel', 'sales_returns', 'Cancel a draft sales return'),
  ('sales_returns.delete', 'sales_returns', 'Delete a draft sales return');

INSERT INTO public.role_permissions (role, permission_key) VALUES
  ('owner', 'sales_returns.create'), ('owner', 'sales_returns.approve'),
  ('owner', 'sales_returns.cancel'), ('owner', 'sales_returns.delete'),
  ('admin', 'sales_returns.create'), ('admin', 'sales_returns.approve'),
  ('admin', 'sales_returns.cancel'), ('admin', 'sales_returns.delete'),
  ('manager', 'sales_returns.create'), ('manager', 'sales_returns.approve'),
  ('manager', 'sales_returns.cancel'), ('manager', 'sales_returns.delete'),
  ('staff', 'sales_returns.create'), ('staff', 'sales_returns.approve'),
  ('staff', 'sales_returns.cancel'),
  ('sales_manager', 'sales_returns.create'), ('sales_manager', 'sales_returns.approve'),
  ('sales_manager', 'sales_returns.cancel'), ('sales_manager', 'sales_returns.delete'),
  ('accountant', 'sales_returns.approve');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_returns TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.sales_return_items TO authenticated;
GRANT ALL ON public.sales_returns TO service_role;
GRANT ALL ON public.sales_return_items TO service_role;
ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org read" ON public.sales_returns FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "org write" ON public.sales_returns FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'sales_returns.create'));
CREATE POLICY "org update" ON public.sales_returns FOR UPDATE TO authenticated USING (
  public.has_permission(org_id, 'sales_returns.create')
  OR public.has_permission(org_id, 'sales_returns.approve')
  OR public.has_permission(org_id, 'sales_returns.cancel')
) WITH CHECK (
  public.has_permission(org_id, 'sales_returns.create')
  OR public.has_permission(org_id, 'sales_returns.approve')
  OR public.has_permission(org_id, 'sales_returns.cancel')
);
CREATE POLICY "org delete" ON public.sales_returns FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'sales_returns.delete'));

CREATE POLICY "org read" ON public.sales_return_items FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "org write" ON public.sales_return_items FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'sales_returns.create'));
-- Draft-only editing replaces the whole line set (delete then reinsert,
-- same as stock transfers), so this is gated on the same permission
-- that lets someone create/edit a draft, not on sales_returns.delete --
-- removing the whole return (which cascades to its items regardless of
-- this policy) is a separate action.
CREATE POLICY "org delete" ON public.sales_return_items FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'sales_returns.create'));

-- Cross-tenant guard + business-state guard on creation: a return can
-- only be opened against a shipped/delivered order in the SAME org as
-- the return row being inserted (closes the "create a return against
-- another organization's sales order" gap called out in the ticket).
-- Not SECURITY DEFINER -- runs as the calling user, so a cross-org
-- attempt fails at the SELECT (RLS hides the other org's order) before
-- it would even reach the explicit org_id check below.
CREATE OR REPLACE FUNCTION public.enforce_sales_return_creation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  _so public.sales_orders%ROWTYPE;
BEGIN
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _so FROM public.sales_orders WHERE id = NEW.sales_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;
  IF _so.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'Sales order does not belong to this organization';
  END IF;
  IF _so.status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'A return can only be created against a shipped or delivered sales order';
  END IF;

  NEW.sales_invoice_id := (SELECT id FROM public.sales_invoices WHERE sales_order_id = NEW.sales_order_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sales_return_creation BEFORE INSERT ON public.sales_returns
FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_return_creation();

-- Same per-transition permission precision as
-- enforce_so_status_transition/enforce_stock_transfer_status_transition
-- (the blanket UPDATE policy above is an OR across every permission
-- relevant to this table), plus the business-state guard that a
-- transition can only be taken from the expected prior status.
CREATE OR REPLACE FUNCTION public.enforce_sales_return_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'service_role' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'approved' THEN
      IF OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'Only a draft return can be approved';
      END IF;
      IF NOT public.has_permission(NEW.org_id, 'sales_returns.approve') THEN
        RAISE EXCEPTION 'Missing sales_returns.approve permission for this transition';
      END IF;
    WHEN 'completed' THEN
      IF OLD.status <> 'approved' THEN
        RAISE EXCEPTION 'Only an approved return can be completed';
      END IF;
      IF NOT public.has_permission(NEW.org_id, 'sales_returns.approve') THEN
        RAISE EXCEPTION 'Missing sales_returns.approve permission for this transition';
      END IF;
    WHEN 'cancelled' THEN
      IF OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'Only a draft return can be cancelled';
      END IF;
      IF NOT public.has_permission(NEW.org_id, 'sales_returns.cancel') THEN
        RAISE EXCEPTION 'Missing sales_returns.cancel permission for this transition';
      END IF;
    ELSE
      IF NOT public.has_permission(NEW.org_id, 'sales_returns.create') THEN
        RAISE EXCEPTION 'Missing sales_returns.create permission for this status transition';
      END IF;
  END CASE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sales_return_status_transition BEFORE UPDATE ON public.sales_returns
FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_return_status_transition();

-- Per-financial-year sequential return numbers (RMA/25-26/0001), same
-- pattern as next_sales_order_number/next_credit_note_number.
CREATE TABLE public.sales_return_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, financial_year)
);
ALTER TABLE public.sales_return_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_sales_return_number(_org_id UUID)
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

  INSERT INTO public.sales_return_counters (org_id, financial_year, next_number)
  VALUES (_org_id, _fy, 2)
  ON CONFLICT (org_id, financial_year)
    DO UPDATE SET next_number = public.sales_return_counters.next_number + 1
  RETURNING next_number - 1 INTO _n;

  RETURN 'RMA/' || _fy || '/' || lpad(_n::TEXT, 4, '0');
END; $$;
REVOKE ALL ON FUNCTION public.next_sales_return_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_sales_return_number(UUID) TO authenticated;

-- Approve a draft return: caps each line against what's left returnable
-- for that product on the order, posts the restock/damage stock
-- movement per line (credit-only lines post nothing), and issues one
-- credit note for the return's total value -- full if it covers
-- everything still uncredited on the invoice, partial otherwise --
-- reusing create_credit_note from SP-5 rather than re-deriving its
-- CGST/SGST/IGST proportional split.
--
-- Unlike confirm_sales_order/ship_stock_transfer and friends, this IS
-- SECURITY DEFINER. Those run as the calling user because the
-- permission that lets them drive the transition is the same
-- permission that lets them insert the resulting stock_movements row
-- (both gated through ordinary RLS). Here that's not true: issuing a
-- credit note is gated by invoices.cancel, and sales_manager -- the
-- role the ticket names for processing returns end-to-end, including
-- "issue the right credit note" -- deliberately does NOT hold
-- invoices.cancel (that's reserved for accountant/owner/admin/manager,
-- see 20260906000100_permission_model.sql). Running as the definer
-- lets this one, narrowly-scoped action -- already gated on its own
-- sales_returns.approve permission, checked explicitly below, exactly
-- like next_sales_order_number's is_org_member check -- create the
-- credit note it needs without widening sales_manager's general
-- credit-note access on the Sales Invoices screen.
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
        CASE WHEN _item.is_damaged THEN 'damage' ELSE 'return' END,
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
