-- The new Team settings page (SP-6) lists every member of the current
-- org with their name/email, which needs reading teammates' profiles --
-- previously profiles.SELECT only allowed reading your own row. Additive
-- policy (OR'd with the existing one): visible to anyone who shares at
-- least one organization with the profile's owner.
CREATE POLICY "org co-members read profile" ON public.profiles FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m1
    JOIN public.organization_members m2 ON m1.org_id = m2.org_id
    WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id
  )
);
