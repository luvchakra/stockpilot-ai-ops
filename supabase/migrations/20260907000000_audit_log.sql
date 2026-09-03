-- Audit log (SP-2, part 2): a tamper-resistant trail of sensitive actions
-- (PO status transitions, stock adjustments, org settings changes), so a
-- billing/inventory dispute can be traced back to who did what and when.
--
-- Rows are written ONLY by SECURITY DEFINER trigger functions below, which
-- run as the migration owner and bypass RLS -- there is no INSERT (or
-- UPDATE/DELETE) grant to `authenticated` at all. That's a stronger
-- guarantee than an RLS policy could give: the client has no write path to
-- this table whatsoever, so an entry can't be forged, edited, or deleted
-- by any client-side call, only ever produced as a side effect of the
-- real change it records.

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_org_created ON public.audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_log_org_entity ON public.audit_log(org_id, entity_type);
CREATE INDEX idx_audit_log_org_actor ON public.audit_log(org_id, actor_id);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read" ON public.audit_log FOR SELECT TO authenticated USING (public.is_org_member(org_id));

-- Purchase order status transitions: covers every path that changes
-- status, including receive_purchase_order_item's own UPDATE, since it's
-- driven by the row change itself rather than by whichever code path
-- triggered it.
CREATE OR REPLACE FUNCTION public.log_po_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_log (org_id, actor_id, action, entity_type, entity_id, before, after)
    VALUES (
      NEW.org_id, auth.uid(), 'purchase_order.status_changed', 'purchase_order', NEW.id,
      jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_po_status_change() FROM PUBLIC;
CREATE TRIGGER trg_audit_po_status_change AFTER UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.log_po_status_change();

-- Stock adjustments: the human-initiated correction movement types (a
-- manual adjustment, flagging damage, or marking stock expired), not the
-- system-driven reserve/unreserve/inbound-from-receiving/outbound-from-
-- shipping movements that already have their own paper trail through the
-- purchase/sales order they belong to. "Reason" is stock_movements.notes,
-- already free-text on the existing Inventory "Record movement" form.
CREATE OR REPLACE FUNCTION public.log_stock_adjustment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type IN ('adjustment', 'damage', 'expired') THEN
    INSERT INTO public.audit_log (org_id, actor_id, action, entity_type, entity_id, before, after)
    VALUES (
      NEW.org_id, NEW.created_by, 'stock.adjusted', 'stock_movement', NEW.id, NULL,
      jsonb_build_object(
        'type', NEW.type, 'quantity', NEW.quantity, 'product_id', NEW.product_id,
        'warehouse_id', NEW.warehouse_id, 'reference', NEW.reference, 'reason', NEW.notes
      )
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_stock_adjustment() FROM PUBLIC;
CREATE TRIGGER trg_audit_stock_adjustment AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.log_stock_adjustment();

-- Organization/business settings changes: exactly the fields the PRD's
-- audit-log module calls out (GSTIN, state, GST registration type,
-- currency, timezone) -- not every organizations column (name/slug/plan
-- changes aren't "business settings" in the sense this ticket means).
CREATE OR REPLACE FUNCTION public.log_org_settings_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.gstin IS DISTINCT FROM OLD.gstin
    OR NEW.state IS DISTINCT FROM OLD.state
    OR NEW.gst_registration_type IS DISTINCT FROM OLD.gst_registration_type
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.timezone IS DISTINCT FROM OLD.timezone
  THEN
    INSERT INTO public.audit_log (org_id, actor_id, action, entity_type, entity_id, before, after)
    VALUES (
      NEW.id, auth.uid(), 'organization.settings_changed', 'organization', NEW.id,
      jsonb_build_object(
        'gstin', OLD.gstin, 'state', OLD.state, 'gst_registration_type', OLD.gst_registration_type,
        'currency', OLD.currency, 'timezone', OLD.timezone
      ),
      jsonb_build_object(
        'gstin', NEW.gstin, 'state', NEW.state, 'gst_registration_type', NEW.gst_registration_type,
        'currency', NEW.currency, 'timezone', NEW.timezone
      )
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_org_settings_change() FROM PUBLIC;
CREATE TRIGGER trg_audit_org_settings_change AFTER UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.log_org_settings_change();
