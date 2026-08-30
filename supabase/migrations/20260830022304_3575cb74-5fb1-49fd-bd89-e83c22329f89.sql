REVOKE ALL ON FUNCTION public.apply_stock_movement() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_org() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.has_org_role(uuid, org_role[]) FROM anon;
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM anon;