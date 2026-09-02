import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  IndianRupee,
  Package,
  PackageCheck,
  Receipt,
  ShoppingCart,
  TrendingDown,
  Truck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, inr, num } from "@/lib/format";
import { isValidGstin } from "@/lib/gst";

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

const OPEN_PO_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "partially_received",
]);

function Dashboard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;

  const summary = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const [products, levels, alerts, movements, purchaseOrders, gstPurchases] = await Promise.all(
        [
          supabase
            .from("products")
            .select("id, name, sku, cost_price, reorder_point")
            .eq("org_id", orgId!),
          supabase
            .from("stock_levels")
            .select("product_id, quantity, reserved, incoming")
            .eq("org_id", orgId!),
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
          supabase
            .from("purchase_orders")
            .select("id, po_number, status, expected_delivery_date, suppliers(name)")
            .eq("org_id", orgId!),
          supabase
            .from("purchase_orders")
            .select("id, cgst_amount, sgst_amount, igst_amount, suppliers(gst_number)")
            .eq("org_id", orgId!)
            .gte("order_date", monthStart),
        ],
      );

      const productList = products.data ?? [];
      const levelList = levels.data ?? [];
      const qtyByProduct = new Map<string, number>();
      let reservedTotal = 0;
      let incomingTotal = 0;
      for (const l of levelList) {
        qtyByProduct.set(l.product_id, (qtyByProduct.get(l.product_id) ?? 0) + Number(l.quantity));
        reservedTotal += Number(l.reserved);
        incomingTotal += Number(l.incoming);
      }
      const unitsOnHand = [...qtyByProduct.values()].reduce((a, b) => a + b, 0);

      const stockValue = productList.reduce(
        (sum, p) => sum + Number(p.cost_price) * (qtyByProduct.get(p.id) ?? 0),
        0,
      );

      let healthy = 0;
      let low = 0;
      let stockout = 0;
      const lowStock: typeof productList = [];
      for (const p of productList) {
        const qty = qtyByProduct.get(p.id) ?? 0;
        if (qty <= 0) {
          stockout++;
          lowStock.push(p);
        } else if (Number(p.reorder_point) > 0 && qty <= Number(p.reorder_point)) {
          low++;
          lowStock.push(p);
        } else {
          healthy++;
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const openPOs = (purchaseOrders.data ?? []).filter((po) => OPEN_PO_STATUSES.has(po.status));
      const overduePOs = openPOs.filter(
        (po) => po.expected_delivery_date && po.expected_delivery_date < today,
      );

      const gstRows = gstPurchases.data ?? [];
      const gstRiskCount = gstRows.filter((po) => !isValidGstin(po.suppliers?.gst_number)).length;
      const gstPayableThisMonth = gstRows.reduce(
        (sum, po) => sum + Number(po.cgst_amount) + Number(po.sgst_amount) + Number(po.igst_amount),
        0,
      );

      return {
        productCount: productList.length,
        stockValue,
        units: unitsOnHand,
        reserved: reservedTotal,
        incoming: incomingTotal,
        available: unitsOnHand - reservedTotal,
        healthy,
        low,
        stockout,
        lowStock,
        pendingPurchases: openPOs.length,
        overduePOs,
        alerts: alerts.data ?? [],
        movements: movements.data ?? [],
        gstRiskCount,
        gstPayableThisMonth,
      };
    },
  });

  const data = summary.data;

  return (
    <AppShell
      title="Operations dashboard"
      description={org ? `${org.name} · live across all warehouses` : "Loading workspace…"}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label="Inventory value"
          value={data ? inr.format(data.stockValue) : undefined}
          icon={<IndianRupee className="size-4 text-signal" />}
        />
        <Kpi
          label="Available stock"
          value={data ? num.format(data.available) : undefined}
          icon={<Package className="size-4 text-signal" />}
        />
        <Kpi
          label="Reserved stock"
          value={data ? num.format(data.reserved) : undefined}
          icon={<PackageCheck className="size-4 text-signal" />}
        />
        <Kpi
          label="Incoming stock"
          value={data ? num.format(data.incoming) : undefined}
          icon={<Truck className="size-4 text-signal" />}
        />
        <Kpi
          label="Stockout risk"
          value={data ? num.format(data.stockout + data.low) : undefined}
          icon={<TrendingDown className="size-4 text-warn" />}
        />
        <Kpi
          label="Pending purchases"
          value={data ? num.format(data.pendingPurchases) : undefined}
          icon={<ShoppingCart className="size-4 text-warn" />}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Daily brief</CardTitle>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{buildBrief(org?.name, data)}</p>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-signal" /> {data.healthy} healthy
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-warn" /> {data.low} low stock
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-destructive" /> {data.stockout} out of
                  stock
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
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
            <CardTitle className="text-base">Attention center</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!data ? (
              <Skeleton className="h-24 w-full" />
            ) : data.overduePOs.length === 0 &&
              data.alerts.length === 0 &&
              data.gstRiskCount === 0 &&
              org?.gstin ? (
              <p className="text-sm text-muted-foreground">
                Nothing needs your attention right now.
              </p>
            ) : (
              <>
                {!org?.gstin ? (
                  <Link
                    to="/account"
                    className="flex items-center justify-between gap-3 text-sm hover:underline"
                  >
                    <p className="min-w-0 truncate font-medium">
                      Set up your workspace's GST profile
                    </p>
                    <Badge variant="outline" className="shrink-0 border-warn/40 text-warn">
                      <Receipt className="size-3" />
                      Setup
                    </Badge>
                  </Link>
                ) : null}
                {data.gstRiskCount > 0 ? (
                  <Link
                    to="/gst-filing"
                    className="flex items-center justify-between gap-3 text-sm hover:underline"
                  >
                    <p className="min-w-0 truncate font-medium">
                      {data.gstRiskCount} purchase{data.gstRiskCount === 1 ? "" : "s"} this month{" "}
                      {data.gstRiskCount === 1 ? "has" : "have"} a missing/invalid supplier GSTIN
                    </p>
                    <Badge variant="destructive" className="shrink-0">
                      <FileWarning className="size-3" />
                      ITC risk
                    </Badge>
                  </Link>
                ) : null}
                {data.overduePOs.slice(0, 3).map((po) => (
                  <div key={po.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{po.po_number}</p>
                      <p className="text-xs text-muted-foreground">{po.suppliers?.name}</p>
                    </div>
                    <Badge variant="destructive" className="shrink-0">
                      <Clock className="size-3" />
                      Overdue
                    </Badge>
                  </div>
                ))}
                {data.alerts.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                    <p className="min-w-0 truncate font-medium">{a.title}</p>
                    <Badge
                      variant={a.severity === "critical" ? "destructive" : "outline"}
                      className="shrink-0"
                    >
                      <AlertTriangle className="size-3" />
                      {a.severity}
                    </Badge>
                  </div>
                ))}
              </>
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

function buildBrief(
  orgName: string | undefined,
  data: {
    stockValue: number;
    productCount: number;
    stockout: number;
    low: number;
    pendingPurchases: number;
    overduePOs: unknown[];
    alerts: unknown[];
    gstPayableThisMonth: number;
  },
) {
  const parts: string[] = [
    `${orgName ?? "Your workspace"}'s inventory is worth ${inr.format(data.stockValue)} across ${num.format(data.productCount)} products.`,
  ];
  if (data.stockout > 0 || data.low > 0) {
    parts.push(
      `${num.format(data.stockout)} ${data.stockout === 1 ? "is" : "are"} out of stock and ${num.format(data.low)} ${data.low === 1 ? "is" : "are"} below reorder point.`,
    );
  } else {
    parts.push("Stock levels are healthy across the board.");
  }
  if (data.pendingPurchases > 0) {
    parts.push(
      `${num.format(data.pendingPurchases)} purchase order${data.pendingPurchases === 1 ? " is" : "s are"} awaiting delivery${
        data.overduePOs.length > 0
          ? `, including ${num.format(data.overduePOs.length)} overdue`
          : ""
      }.`,
    );
  }
  if (data.alerts.length > 0) {
    parts.push(
      `${num.format(data.alerts.length)} open alert${data.alerts.length === 1 ? "" : "s"} need attention.`,
    );
  }
  if (data.gstPayableThisMonth > 0) {
    parts.push(`GST paid on purchases this month so far: ${inr.format(data.gstPayableThisMonth)}.`);
  }
  return parts.join(" ");
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
