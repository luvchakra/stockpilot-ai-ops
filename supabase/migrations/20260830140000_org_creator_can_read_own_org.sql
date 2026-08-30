-- Fix onboarding: creating an organization does
--   INSERT ... RETURNING (via PostgREST's .insert().select().single())
-- which requires the new row to pass the SELECT policy, not just the
-- INSERT policy. The SELECT policy only allowed org members to read a
-- row, and the creator only becomes a member via the on_org_created
-- AFTER INSERT trigger — so the read-back can race the trigger's
-- effect within the same statement and return zero rows, making
-- .single() throw even though the organization was created
-- successfully. Let the creator read their own row unconditionally, in
-- addition to being a member, so this can't race.
DROP POLICY IF EXISTS "members read org" ON public.organizations;
CREATE POLICY "members read org" ON public.organizations FOR SELECT TO authenticated
USING (public.is_org_member(id) OR created_by = auth.uid());
