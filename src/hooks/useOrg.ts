import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrgRole = Database["public"]["Enums"]["org_role"];

const STORAGE_KEY = "stockpilot.org";
const SELECTED_ORG_QUERY_KEY = ["selected-org-id"] as const;

export type Membership = { role: OrgRole; organizations: Organization };

export function useMemberships() {
  return useQuery({
    queryKey: ["memberships"],
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("role, organizations(*)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).filter((m) => m.organizations) as unknown as Membership[];
    },
  });
}

// Writes the active business id to both localStorage (so it survives a
// reload) and the shared query cache (so every useCurrentOrg() call site —
// the header switcher, every page, onboarding — sees the change
// immediately, instead of each holding its own independent copy).
export function setActiveOrgId(queryClient: QueryClient, id: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  queryClient.setQueryData(SELECTED_ORG_QUERY_KEY, id);
}

export function useCurrentOrg() {
  const memberships = useMemberships();
  const queryClient = useQueryClient();

  const selectedOrgId = useQuery({
    queryKey: SELECTED_ORG_QUERY_KEY,
    queryFn: () =>
      typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null,
    staleTime: Infinity,
  });

  const list = memberships.data ?? [];
  const orgId = selectedOrgId.data ?? null;
  const active = list.find((m) => m.organizations.id === orgId) ?? list[0] ?? undefined;

  const selectOrg = (id: string) => setActiveOrgId(queryClient, id);

  return {
    loading: memberships.isLoading,
    memberships: list,
    org: active?.organizations,
    role: active?.role,
    selectOrg,
    refetch: memberships.refetch,
  };
}
