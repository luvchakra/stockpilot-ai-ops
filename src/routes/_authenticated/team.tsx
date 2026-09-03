import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";
import { usePermissionCatalog, useRolePermissions } from "@/hooks/usePermissions";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team — StockPilot" },
      { name: "description", content: "Members, roles and what each role can do." },
    ],
  }),
  component: Team,
});

const ACTIVE_ROLES = [
  "owner",
  "admin",
  "inventory_manager",
  "procurement_manager",
  "sales_manager",
  "accountant",
  "warehouse_operator",
  "viewer",
] as const;

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  inventory_manager: "Inventory Manager",
  procurement_manager: "Procurement Manager",
  sales_manager: "Sales Manager",
  accountant: "Accountant",
  warehouse_operator: "Warehouse Operator",
  viewer: "Viewer",
  manager: "Manager (legacy)",
  staff: "Staff (legacy)",
};

function Team() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;
  const catalog = usePermissionCatalog();
  const rolePermissions = useRolePermissions();

  // organization_members.user_id has no foreign key to profiles (it's a
  // plain UUID, so custom-role/service-created members never require a
  // matching auth user up front) -- so names are joined client-side rather
  // than embedded in the select.
  const members = useQuery({
    queryKey: ["organization_members", orgId, "team"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("organization_members")
        .select("id, user_id, role, created_at")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const userIds = (rows ?? []).map((r) => r.user_id);
      const { data: profiles, error: profilesError } = userIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

      return (rows ?? []).map((r) => ({ ...r, profile: profileById.get(r.user_id) }));
    },
  });

  const loading = members.isLoading || catalog.isLoading || rolePermissions.isLoading;

  return (
    <AppShell
      title="Team"
      description="Members, their role, and exactly what that role can do. Read-only — permissions are set by role, not per person, until custom roles ship."
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="overflow-x-auto rounded-2xl border border-border panel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members.data ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">{m.profile?.full_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.profile?.email ?? m.user_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABEL[m.role] ?? m.role}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(m.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div>
            <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold">
              <Shield className="size-4" />
              Roles &amp; permissions
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The eight default roles and exactly what each one can do. Custom roles aren't
              available yet.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {ACTIVE_ROLES.map((role) => {
                const granted = rolePermissions.data?.[role] ?? new Set<string>();
                const grantedPermissions = (catalog.data ?? []).filter((p) => granted.has(p.key));
                return (
                  <div key={role} className="panel rounded-2xl border border-border p-4">
                    <p className="font-medium">{ROLE_LABEL[role]}</p>
                    {grantedPermissions.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        View-only. No write access.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {grantedPermissions.map((p) => (
                          <li key={p.key}>{p.description}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
