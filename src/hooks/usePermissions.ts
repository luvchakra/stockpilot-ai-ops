import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";

// Client-side mirror of the has_permission() RLS check: a UX layer that
// hides/disables actions the current user lacks, on top of the database
// enforcement that role_permissions/has_permission() actually provide.
// role_permissions is small and holds no per-organization data, so it's
// fetched once and shared across every page via the query cache rather
// than re-queried per permission check.
export function useRolePermissions() {
  return useQuery({
    queryKey: ["role_permissions"],
    queryFn: async (): Promise<Record<string, Set<string>>> => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("role, permission_key");
      if (error) throw error;
      const byRole: Record<string, Set<string>> = {};
      for (const row of data ?? []) {
        (byRole[row.role] ??= new Set()).add(row.permission_key);
      }
      return byRole;
    },
    staleTime: Infinity,
  });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permissions")
        .select("key, module, description")
        .order("key");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: Infinity,
  });
}

export function usePermissions() {
  const { org, role, loading: orgLoading } = useCurrentOrg();
  const rolePermissions = useRolePermissions();

  const granted = (role && rolePermissions.data?.[role]) || new Set<string>();

  return {
    org,
    role,
    loading: orgLoading || rolePermissions.isLoading,
    can: (key: string) => granted.has(key),
    permissions: granted,
  };
}
