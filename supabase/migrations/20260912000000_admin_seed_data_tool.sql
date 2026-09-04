-- Bookkeeping tables for the platform-admin "seed demo data" tool.
--
-- These are deliberately NOT granted to `authenticated` at all (not just
-- RLS-denied): only the service-role admin client the /admin page's server
-- functions use can read or write them. They exist so a demo-data run can
-- be cleanly and exactly reversed later -- every row the seeder inserts
-- into any business table is recorded here, and "delete demo data" deletes
-- by exactly those recorded ids rather than guessing from naming
-- conventions, so it can never touch a business's real data.

CREATE TABLE public.demo_seed_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL,
  requested_by UUID NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.demo_seed_batches TO service_role;
REVOKE ALL ON public.demo_seed_batches FROM anon, authenticated;
ALTER TABLE public.demo_seed_batches ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.demo_seed_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.demo_seed_batches(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_demo_seed_records_batch ON public.demo_seed_records(batch_id);
CREATE INDEX idx_demo_seed_records_org_lookup ON public.demo_seed_records(table_name, record_id);
GRANT ALL ON public.demo_seed_records TO service_role;
REVOKE ALL ON public.demo_seed_records FROM anon, authenticated;
ALTER TABLE public.demo_seed_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_demo_seed_batches_org ON public.demo_seed_batches(org_id);
