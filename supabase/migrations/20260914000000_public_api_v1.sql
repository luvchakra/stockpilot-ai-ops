-- Public REST API v1 (SP-12): API keys + per-org rate limiting.
--
-- Design (proposed in the ticket and confirmed before implementation):
-- an API key snapshots the issuing user's role's permission set at
-- creation time -- a fixed list of permission keys, not a live pointer
-- to their role -- rather than impersonating that user's JWT per
-- request. This is simpler to reason about (a key's access never
-- silently changes if the issuer's role is later edited) at the cost
-- that revoking/reissuing is how you pick up a permission change.
--
-- Reads (GET) only require a valid, non-revoked key for the org --
-- matching the UI's own read model, where every org member (even
-- viewer) can read this data via a plain `is_org_member` RLS policy
-- with no per-module permission gate. Writes (POST/PATCH) require the
-- specific permission in the key's snapshot, checked in application
-- code by the API layer (src/lib/api-v1/*) since these requests carry
-- no Supabase session for RLS to key off of -- the API layer runs as
-- service_role and is solely responsible for scoping every query to
-- the key's own org_id and for this permission check, exactly mirroring
-- what has_permission()/RLS already enforce for the UI.

CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- First 12 chars of the raw key (e.g. "sk_live_ab12"), shown in the UI
  -- so an admin can tell keys apart without ever re-displaying the full
  -- value after creation.
  key_prefix TEXT NOT NULL,
  -- Snapshot of the issuing user's role's permission keys at the moment
  -- this key was created (see header comment).
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL DEFAULT auth.uid(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The actual secret, split into its own table with no client-facing
-- SELECT/UPDATE/DELETE policy at all -- same secrecy pattern as
-- eway_bill_credentials/einvoice_credentials, adapted for a table with
-- many rows instead of one per org. Only ever written once at creation
-- (see the "org write" policy below); read back only by the service-role
-- API layer verifying an incoming request's bearer token.
CREATE TABLE public.api_key_secrets (
  api_key_id UUID PRIMARY KEY REFERENCES public.api_keys(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_api_keys_org ON public.api_keys(org_id);

GRANT SELECT, INSERT, UPDATE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
GRANT INSERT ON public.api_key_secrets TO authenticated;
GRANT ALL ON public.api_key_secrets TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org read" ON public.api_keys FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'settings.manage'));
CREATE POLICY "org write" ON public.api_keys FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'settings.manage'));
-- Revoking (and renaming) a key is an UPDATE, not a DELETE -- api_keys
-- stays append-only so Organization Settings can show a full history of
-- every key ever issued, like audit_log.
CREATE POLICY "org update" ON public.api_keys FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'settings.manage'))
  WITH CHECK (public.has_permission(org_id, 'settings.manage'));

CREATE POLICY "org write" ON public.api_key_secrets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.api_keys k
    WHERE k.id = api_key_id AND public.has_permission(k.org_id, 'settings.manage')
  ));

-- Per-org, per-minute request counter -- a sane default rate limit
-- (the ticket asks for "at minimum" this; tiering by plan is a fast-
-- follow once a pricing model exists). No client-facing policies: only
-- the service-role API layer's check_api_rate_limit() call touches this.
CREATE TABLE public.api_rate_limit_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, window_start)
);
ALTER TABLE public.api_rate_limit_counters ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.api_rate_limit_counters TO service_role;

-- Atomic check-and-increment for the current minute's window. Returns
-- false once the org has exceeded `_limit` requests in this window, so
-- the API layer can respond 429 without a separate read-then-write
-- race. SECURITY DEFINER + no authenticated grant: only service_role
-- (the API layer itself) ever calls this.
CREATE OR REPLACE FUNCTION public.check_api_rate_limit(_org_id UUID, _limit INTEGER DEFAULT 120)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _window TIMESTAMPTZ := date_trunc('minute', now());
  _count INTEGER;
BEGIN
  INSERT INTO public.api_rate_limit_counters (org_id, window_start, request_count)
  VALUES (_org_id, _window, 1)
  ON CONFLICT (org_id, window_start)
    DO UPDATE SET request_count = public.api_rate_limit_counters.request_count + 1
  RETURNING request_count INTO _count;

  RETURN _count <= _limit;
END; $$;
REVOKE ALL ON FUNCTION public.check_api_rate_limit(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_api_rate_limit(UUID, INTEGER) TO service_role;
