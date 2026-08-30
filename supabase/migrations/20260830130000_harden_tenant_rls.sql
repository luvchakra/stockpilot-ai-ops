-- Harden multi-tenant RLS: close privilege-escalation paths in
-- organization_members, stop viewers from writing business data, make the
-- stock ledger append-only, and restrict billing-plan changes to owners.

-- 1-3. organization_members: an admin must never be able to grant, hold, or
-- remove the 'owner' role. Only an existing owner can touch an owner row or
-- assign the owner role.
DROP POLICY IF EXISTS "self join as creator" ON public.organization_members;
CREATE POLICY "self join as creator" ON public.organization_members FOR INSERT TO authenticated WITH CHECK (
  (
    user_id = auth.uid()
    AND role = 'owner'
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = org_id AND o.created_by = auth.uid())
  )
  OR public.has_org_role(org_id, ARRAY['owner']::public.org_role[])
  OR (public.has_org_role(org_id, ARRAY['admin']::public.org_role[]) AND role <> 'owner')
);

DROP POLICY IF EXISTS "admins update members" ON public.organization_members;
CREATE POLICY "admins update members" ON public.organization_members FOR UPDATE TO authenticated
USING (
  public.has_org_role(org_id, ARRAY['owner']::public.org_role[])
  OR (public.has_org_role(org_id, ARRAY['admin']::public.org_role[]) AND role <> 'owner')
)
WITH CHECK (
  public.has_org_role(org_id, ARRAY['owner']::public.org_role[])
  OR (public.has_org_role(org_id, ARRAY['admin']::public.org_role[]) AND role <> 'owner')
);

DROP POLICY IF EXISTS "admins remove members" ON public.organization_members;
CREATE POLICY "admins remove members" ON public.organization_members FOR DELETE TO authenticated USING (
  public.has_org_role(org_id, ARRAY['owner']::public.org_role[])
  OR (public.has_org_role(org_id, ARRAY['admin']::public.org_role[]) AND role <> 'owner')
);

-- 4. Business tables: writing requires staff or above; viewers stay read-only.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['warehouses','categories','suppliers','products','stock_levels','stock_movements','alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org write" ON public.%I', t);
    EXECUTE format('CREATE POLICY "org write" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''manager'',''staff'']::public.org_role[]))', t);
  END LOOP;
END $$;

-- 5. Stock movements are an immutable ledger: no one may update or delete
-- a posted movement, only insert new ones.
DROP POLICY IF EXISTS "org update" ON public.stock_movements;
DROP POLICY IF EXISTS "org delete" ON public.stock_movements;

-- 6. Billing/plan changes require the owner role, even though admins can
-- otherwise update the organization row.
CREATE OR REPLACE FUNCTION public.prevent_non_owner_plan_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND NOT public.has_org_role(NEW.id, ARRAY['owner']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only the organization owner can change the billing plan';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.prevent_non_owner_plan_change() FROM PUBLIC;
CREATE TRIGGER trg_org_plan_owner_only BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.prevent_non_owner_plan_change();
