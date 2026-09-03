-- e-Way Bill generation (SP-7).
--
-- IMPORTANT CONTEXT for anyone picking this up: e-Way Bill access in India
-- is GSP-mediated -- direct NIC (government) API access requires >=1000
-- bills/day, a static IP and an SSL-enabled domain, out of reach for this
-- product's actual customers. In practice a business goes through a
-- commercial GSP (ClearTax, MasterGST, Vayana, Whitebooks, etc.), each
-- exposing its own REST wrapper around the same underlying NIC Part-A/
-- Part-B JSON schema. There is no single vendor to hardcode against, so
-- this schema and the server integration built on top of it are
-- deliberately GSP-agnostic: an org configures its own GSP's auth/
-- generate/cancel URLs and credentials, and the payload shape follows the
-- documented NIC schema that virtually every GSP mirrors closely.
--
-- GSP credentials are a real secret (same class of risk as SP-2's
-- reveal-service-role-key finding) -- see the "no SELECT grant to
-- authenticated" note below.

-- SECRET STORAGE: no SELECT grant/policy for `authenticated` at all. The
-- credential values must never reach the browser -- only service_role
-- (used server-side by the eway-bill generate/cancel server function) can
-- read this table. Non-secret status (which GSP, which URLs, last
-- updated) is exposed separately via eway_bill_credentials_status(), a
-- SECURITY DEFINER function that never selects the secret columns.
CREATE TABLE public.eway_bill_credentials (
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
GRANT INSERT, UPDATE, DELETE ON public.eway_bill_credentials TO authenticated;
GRANT ALL ON public.eway_bill_credentials TO service_role;
ALTER TABLE public.eway_bill_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings managers write" ON public.eway_bill_credentials FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'settings.manage'));
CREATE POLICY "settings managers update" ON public.eway_bill_credentials FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'settings.manage')) WITH CHECK (public.has_permission(org_id, 'settings.manage'));
CREATE POLICY "settings managers delete" ON public.eway_bill_credentials FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'settings.manage'));
CREATE TRIGGER trg_eway_bill_credentials_updated BEFORE UPDATE ON public.eway_bill_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.eway_bill_credentials_status(_org UUID)
RETURNS TABLE(gsp_provider TEXT, auth_url TEXT, generate_url TEXT, cancel_url TEXT, updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.gsp_provider, c.auth_url, c.generate_url, c.cancel_url, c.updated_at
  FROM public.eway_bill_credentials c
  WHERE c.org_id = _org AND public.is_org_member(_org);
$$;
REVOKE ALL ON FUNCTION public.eway_bill_credentials_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eway_bill_credentials_status(UUID) TO authenticated;

-- Generated bills, one row per generation (a cancelled bill's row stays,
-- new generation gets a new row) -- so a source transaction's full
-- generate/cancel/regenerate history is visible, not just its latest state.
CREATE TYPE public.eway_bill_status AS ENUM ('generated', 'cancelled', 'expired');
CREATE TYPE public.eway_bill_source_type AS ENUM ('sales_order', 'sales_invoice', 'purchase_order');

CREATE TABLE public.eway_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type public.eway_bill_source_type NOT NULL,
  source_id UUID NOT NULL,
  ewb_number TEXT NOT NULL,
  ewb_date TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status public.eway_bill_status NOT NULL DEFAULT 'generated',
  vehicle_number TEXT,
  transporter_id TEXT,
  transporter_name TEXT,
  transport_mode TEXT NOT NULL,
  distance_km NUMERIC,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  request_payload JSONB NOT NULL,
  response_payload JSONB NOT NULL,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_eway_bills_org ON public.eway_bills(org_id);
CREATE INDEX idx_eway_bills_source ON public.eway_bills(source_type, source_id);
-- Only one ACTIVE bill per source transaction at a time -- cancelling
-- frees the source up for a fresh regeneration.
CREATE UNIQUE INDEX uq_eway_bills_active_source ON public.eway_bills(source_type, source_id)
  WHERE status = 'generated';

GRANT SELECT, INSERT, UPDATE ON public.eway_bills TO authenticated;
GRANT ALL ON public.eway_bills TO service_role;
ALTER TABLE public.eway_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read" ON public.eway_bills FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org write" ON public.eway_bills FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'eway_bills.generate'));
CREATE POLICY "org cancel" ON public.eway_bills FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'eway_bills.cancel')) WITH CHECK (public.has_permission(org_id, 'eway_bills.cancel'));
-- No DELETE policy: like an invoice, a generated e-Way Bill is a legal
-- document -- cancel (a status flip) is the only way to retire one.

-- Permission catalog: who can generate/cancel e-Way Bills. Matches the
-- ticket's own persona (accountant/warehouse dispatcher) plus the roles
-- already responsible for the source transactions.
INSERT INTO public.permissions (key, module, description) VALUES
  ('eway_bills.generate', 'eway_bills', 'Generate an e-Way Bill from a sales order, invoice, or purchase order'),
  ('eway_bills.cancel', 'eway_bills', 'Cancel a generated e-Way Bill within the portal''s allowed window');

INSERT INTO public.role_permissions (role, permission_key) VALUES
  ('owner', 'eway_bills.generate'), ('owner', 'eway_bills.cancel'),
  ('admin', 'eway_bills.generate'), ('admin', 'eway_bills.cancel'),
  ('accountant', 'eway_bills.generate'), ('accountant', 'eway_bills.cancel'),
  ('sales_manager', 'eway_bills.generate'), ('sales_manager', 'eway_bills.cancel'),
  ('procurement_manager', 'eway_bills.generate'), ('procurement_manager', 'eway_bills.cancel'),
  ('warehouse_operator', 'eway_bills.generate'), ('warehouse_operator', 'eway_bills.cancel'),
  ('manager', 'eway_bills.generate'), ('manager', 'eway_bills.cancel'),
  ('staff', 'eway_bills.generate'), ('staff', 'eway_bills.cancel');
