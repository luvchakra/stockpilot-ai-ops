-- e-Invoicing: IRN + QR code generation (SP-8).
--
-- Like SP-7's e-Way Bill work, real-world e-Invoicing access to the
-- government's Invoice Registration Portal (IRP) is GSP-mediated
-- (ClearTax, MasterGST, Vayana, etc.) rather than a single direct API
-- most businesses can reach. This schema and the server integration on
-- top of it are deliberately GSP-agnostic and independent of the e-Way
-- Bill feature: an org configures its own GSP's auth/generate/cancel
-- URLs and credentials, and the payload follows the GST INV-01 schema
-- that GSPs mirror closely.
--
-- GSP credentials are a real secret (same class of risk as SP-2's
-- reveal-service-role-key finding and SP-7's e-Way Bill credentials) --
-- see the "no SELECT grant to authenticated" note below.

CREATE TABLE public.einvoice_credentials (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  gsp_provider TEXT NOT NULL,
  auth_url TEXT NOT NULL,
  generate_url TEXT NOT NULL,
  cancel_url TEXT NOT NULL,
  gsp_username TEXT,
  gsp_password TEXT,
  client_id TEXT,
  client_secret TEXT,
  updated_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT, UPDATE, DELETE ON public.einvoice_credentials TO authenticated;
GRANT ALL ON public.einvoice_credentials TO service_role;
ALTER TABLE public.einvoice_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings managers write" ON public.einvoice_credentials FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'settings.manage'));
CREATE POLICY "settings managers update" ON public.einvoice_credentials FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'settings.manage')) WITH CHECK (public.has_permission(org_id, 'settings.manage'));
CREATE POLICY "settings managers delete" ON public.einvoice_credentials FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'settings.manage'));
CREATE TRIGGER trg_einvoice_credentials_updated BEFORE UPDATE ON public.einvoice_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Same "no SELECT for authenticated" secret-lockdown pattern as
-- eway_bill_credentials: only service_role (used server-side by the
-- generate/cancel server functions) can read the secret columns.
-- Non-secret status is exposed separately via this SECURITY DEFINER
-- function, which never selects the secret columns.
CREATE OR REPLACE FUNCTION public.einvoice_credentials_status(_org UUID)
RETURNS TABLE(gsp_provider TEXT, auth_url TEXT, generate_url TEXT, cancel_url TEXT, updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.gsp_provider, c.auth_url, c.generate_url, c.cancel_url, c.updated_at
  FROM public.einvoice_credentials c
  WHERE c.org_id = _org AND public.is_org_member(_org);
$$;
REVOKE ALL ON FUNCTION public.einvoice_credentials_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.einvoice_credentials_status(UUID) TO authenticated;

-- One row per IRN generation -- a cancelled IRN's row stays, so a sales
-- invoice's full generate/cancel history is visible, not just its
-- latest state.
CREATE TYPE public.einvoice_status AS ENUM ('generated', 'cancelled');

CREATE TABLE public.einvoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  irn TEXT NOT NULL,
  ack_no TEXT NOT NULL,
  ack_date TIMESTAMPTZ NOT NULL,
  qr_code TEXT NOT NULL,
  status public.einvoice_status NOT NULL DEFAULT 'generated',
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  request_payload JSONB NOT NULL,
  response_payload JSONB NOT NULL,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_einvoices_org ON public.einvoices(org_id);
CREATE INDEX idx_einvoices_invoice ON public.einvoices(invoice_id);
-- Only one ACTIVE IRN per invoice at a time -- cancelling frees the
-- invoice up for a fresh generation.
CREATE UNIQUE INDEX uq_einvoices_active_invoice ON public.einvoices(invoice_id)
  WHERE status = 'generated';

GRANT SELECT, INSERT, UPDATE ON public.einvoices TO authenticated;
GRANT ALL ON public.einvoices TO service_role;
ALTER TABLE public.einvoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read" ON public.einvoices FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org write" ON public.einvoices FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'einvoices.generate'));
CREATE POLICY "org cancel" ON public.einvoices FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'einvoices.cancel')) WITH CHECK (public.has_permission(org_id, 'einvoices.cancel'));
-- No DELETE policy: like an invoice itself, a generated IRN is a legal
-- record -- cancel (a status flip) is the only way to retire one.

-- Permission catalog: e-Invoicing is a sales/accounting concern (unlike
-- e-Way Bill, it never applies to purchase orders), so it's granted to
-- the same roles that can create/manage invoices -- mirroring the
-- invoices.create/edit/cancel split (sales_manager can only generate,
-- not cancel; accountant can do both).
INSERT INTO public.permissions (key, module, description) VALUES
  ('einvoices.generate', 'einvoices', 'Submit a sales invoice to the IRP and record its IRN/QR code'),
  ('einvoices.cancel', 'einvoices', 'Cancel a generated e-Invoice (IRN) within the IRP''s allowed window');

INSERT INTO public.role_permissions (role, permission_key) VALUES
  ('owner', 'einvoices.generate'), ('owner', 'einvoices.cancel'),
  ('admin', 'einvoices.generate'), ('admin', 'einvoices.cancel'),
  ('accountant', 'einvoices.generate'), ('accountant', 'einvoices.cancel'),
  ('sales_manager', 'einvoices.generate'),
  ('manager', 'einvoices.generate'), ('manager', 'einvoices.cancel'),
  ('staff', 'einvoices.generate'), ('staff', 'einvoices.cancel');
