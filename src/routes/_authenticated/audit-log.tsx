import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/audit-log")({
  head: () => ({
    meta: [
      { title: "Audit Log — StockPilot" },
      {
        name: "description",
        content: "Who changed what and when — purchase orders, stock, and business settings.",
      },
    ],
  }),
  component: AuditLog,
});

type AuditLogRow = Database["public"]["Tables"]["audit_log"]["Row"];

const ACTION_LABEL: Record<string, string> = {
  "purchase_order.status_changed": "Purchase order status changed",
  "stock.adjusted": "Stock adjusted",
  "organization.settings_changed": "Organization settings changed",
};

const ENTITY_TYPE_LABEL: Record<string, string> = {
  purchase_order: "Purchase Order",
  stock_movement: "Stock Movement",
  organization: "Organization",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A compact, human-readable summary of what changed: "field: old → new" when
// there's a before snapshot to diff against, or just the recorded fields
// when there isn't (e.g. a stock adjustment has no meaningful "before").
function describeChange(row: AuditLogRow): string {
  const after = isPlainObject(row.after) ? row.after : null;
  const before = isPlainObject(row.before) ? row.before : null;
  if (!after) return "—";
  if (!before) {
    return Object.entries(after)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");
  }
  const changed = Object.keys(after).filter(
    (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
  );
  if (changed.length === 0) return "—";
  return changed.map((k) => `${k}: ${before[k] ?? "—"} → ${after[k] ?? "—"}`).join(", ");
}

function AuditLog() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;
  const [entityType, setEntityType] = useState("all");
  const [actorId, setActorId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Actor names are joined client-side: audit_log.actor_id has no foreign
  // key (an actor may since have left the org), same reasoning as the Team
  // page's member/profile join.
  const actors = useQuery({
    queryKey: ["organization_members", orgId, "audit-actors"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("org_id", orgId!);
      if (error) throw error;
      const userIds = [...new Set((rows ?? []).map((r) => r.user_id))];
      if (userIds.length === 0) return [];
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      if (profilesError) throw profilesError;
      return profiles ?? [];
    },
  });
  const actorNameById = new Map(
    (actors.data ?? []).map((p) => [p.id, p.full_name || p.email || p.id]),
  );

  const auditLog = useQuery({
    queryKey: ["audit_log", orgId, entityType, actorId, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let query = supabase
        .from("audit_log")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (entityType !== "all") query = query.eq("entity_type", entityType);
      if (actorId !== "all") query = query.eq("actor_id", actorId);
      if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
      if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell
      title="Audit Log"
      description="A read-only, chronological record of who changed what and when."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Entity</Label>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {Object.entries(ENTITY_TYPE_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Actor</Label>
          <Select value={actorId} onValueChange={setActorId}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              {(actors.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name || p.email || p.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            className="w-40"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            className="w-40"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {auditLog.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !auditLog.data || auditLog.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <History className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No audit entries match these filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLog.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {actorNameById.get(row.actor_id) ?? row.actor_id}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {ENTITY_TYPE_LABEL[row.entity_type] ?? row.entity_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {ACTION_LABEL[row.action] ?? row.action}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                    {describeChange(row)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
