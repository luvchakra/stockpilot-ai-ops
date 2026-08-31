import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, IndianRupee, Package, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, inr, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Operations dashboard — StockPilot" },
      {
        name: "description",
        content:
          "Live inventory value, low-stock exposure, open alerts and recent stock movements across every warehouse.",
      },
      { property: "og:title", content: "StockPilot operations dashboard" },
      {
        property: "og:description",
        content: "Live inventory value, low-stock exposure and recent stock movements.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;

  const summary = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [products, levels, alerts, movements] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, sku, cost_price, reorder_point")
          .eq("org_id", orgId!),
        supabase.from("stock_levels").select("product_id, quantity").eq("org_id", orgId!),
        supabase
          .from("alerts")
          .select("id, title, severity, created_at")
          .eq("org_id", orgId!)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("stock_movements")
          .select("id, type, quantity, created_at, products(name, sku)")
          .eq("org_id", orgId!)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      const productList = products.data ?? [];
      const levelList = levels.data ?? [];
      const qtyByProduct = new Map<string, number>();
      for (const l of levelList) {
        qtyByProduct.set(l.product_id, (qtyByProduct.get(l.product_id) ?? 0) + Number(l.quantity));
      }
      const stockValue = productList.reduce(
        (sum, p) => sum + Number(p.cost_price) * (qtyByProduct.get(p.id) ?? 0),
        0,
      );
      const lowStock = productList.filter(
        (p) => (qtyByProduct.get(p.id) ?? 0) <= Number(p.reorder_point),
      );

      return {
        productCount: productList.length,
        stockValue,
        units: [...qtyByProduct.values()].reduce((a, b) => a + b, 0),
        lowStock,
        alerts: alerts.data ?? [],
        movements: movements.data ?? [],
      };
    },
  });

  const data = summary.data;

  return (
    <AppShell
      title="Operations dashboard"
      description={org ? `${org.name} · live across all warehouses` : "Loading workspace…"}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Inventory value"
          value={data ? inr.format(data.stockValue) : undefined}
          icon={<IndianRupee className="size-4 text-signal" />}
        />
        <Kpi
          label="Units on hand"
          value={data ? num.format(data.units) : undefined}
          icon={<Package className="size-4 text-signal" />}
        />
        <Kpi
          label="Below reorder point"
          value={data ? num.format(data.lowStock.length) : undefined}
          icon={<TrendingDown className="size-4 text-warn" />}
        />
        <Kpi
          label="Open alerts"
          value={data ? num.format(data.alerts.length) : undefined}
          icon={<AlertTriangle className="size-4 text-warn" />}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reorder watchlist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!data ? (
              <Skeleton className="h-24 w-full" />
            ) : data.lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing below its reorder point. Add products and stock movements to populate this.
              </p>
            ) : (
              data.lowStock.slice(0, 6).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <Badge variant="outline" className="border-warn/40 text-warn">
                    Reorder {num.format(Number(p.reorder_point))}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent stock movements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!data ? (
              <Skeleton className="h-24 w-full" />
            ) : data.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
            ) : (
              data.movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {(m.products as { name: string } | null)?.name ?? "Product"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.type.replace("_", " ")} · {formatDate(m.created_at)}
                    </p>
                  </div>
                  <span className="font-mono text-sm">{num.format(Number(m.quantity))}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string | undefined;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {icon}
        </div>
        {value === undefined ? (
          <Skeleton className="mt-3 h-8 w-24" />
        ) : (
          <p className="mt-2 font-display text-2xl font-bold tracking-tight">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
