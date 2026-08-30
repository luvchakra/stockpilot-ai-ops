import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrgRole = Database["public"]["Enums"]["org_role"];

const STORAGE_KEY = "stockpilot.org";

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

export function useCurrentOrg() {
  const memberships = useMemberships();
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrgId(window.localStorage.getItem(STORAGE_KEY));
  }, []);

  const list = memberships.data ?? [];
  const active =
    list.find((m) => m.organizations.id === orgId) ?? list[0] ?? undefined;

  const selectOrg = (id: string) => {
    window.localStorage.setItem(STORAGE_KEY, id);
    setOrgId(id);
  };

  return {
    loading: memberships.isLoading,
    memberships: list,
    org: active?.organizations,
    role: active?.role,
    selectOrg,
    refetch: memberships.refetch,
  };
}
