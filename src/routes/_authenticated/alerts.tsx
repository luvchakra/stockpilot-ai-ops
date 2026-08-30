import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bell, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — StockPilot" },
      { name: "description", content: "Everything that needs your attention today." },
    ],
  }),
  component: Alerts,
});

type AlertStatus = Database["public"]["Enums"]["alert_status"];

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  info: "secondary",
  warning: "default",
  critical: "destructive",
};

function Alerts() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;
  const queryClient = useQueryClient();

  const alerts = useQuery({
    queryKey: ["alerts", orgId, "all"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AlertStatus }) => {
      const patch: { status: AlertStatus; resolved_at?: string } = { status };
      if (status === "resolved" || status === "dismissed") {
        patch.resolved_at = new Date().toISOString();
      }
      const { error } = await supabase.from("alerts").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", orgId, "all"] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update alert"),
  });

  const openAlerts = (alerts.data ?? []).filter((a) => a.status === "open" || a.status === "acknowledged");
  const closedAlerts = (alerts.data ?? []).filter((a) => a.status === "resolved" || a.status === "dismissed");

  return (
    <AppShell title="Alerts" description="Everything that needs your attention today.">
      {alerts.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !alerts.data || alerts.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <Bell className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No alerts. Everything looks healthy.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            {openAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open alerts.</p>
            ) : (
              openAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="panel flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{alert.title}</span>
                        <Badge variant={SEVERITY_VARIANT[alert.severity] ?? "secondary"}>
                          {alert.severity}
                        </Badge>
                      </div>
                      {alert.description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
                      ) : null}
                      {alert.recommended_action ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Recommended: {alert.recommended_action}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(alert.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {alert.status === "open" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateStatus.mutate({ id: alert.id, status: "acknowledged" })}
                      >
                        Acknowledge
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus.mutate({ id: alert.id, status: "resolved" })}
                    >
                      <CheckCircle2 className="size-4" />
                      Resolve
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateStatus.mutate({ id: alert.id, status: "dismissed" })}
                    >
                      <XCircle className="size-4" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {closedAlerts.length > 0 ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Resolved &amp; dismissed</h2>
              <div className="space-y-2">
                {closedAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground"
                  >
                    <span>{alert.title}</span>
                    <Badge variant="secondary">{alert.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
