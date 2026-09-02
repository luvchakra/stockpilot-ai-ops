import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  FileWarning,
  IndianRupee,
  Package,
  PackageCheck,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDate, inr, num } from "@/lib/format";
import { isValidGstin } from "@/lib/gst";
import { cn } from "@/lib/utils";

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

// A PO's outstanding (ordered - received) quantity counts as "incoming"
// once it's a confirmed order the supplier is acting on, not while it's
// still a draft or awaiting approval.
const INCOMING_PO_STATUSES = new Set(["approved", "sent", "partially_received"]);

// Mirrors the sign convention the apply_stock_movement DB trigger uses to
// keep stock_levels in sync, so "increase" here means the same thing it
// means to the ledger.
const INCREASE_TYPES = new Set(["inbound", "transfer_in", "return", "adjustment"]);

const MOVEMENT_DAYS = 14;

function last14DayKeys() {
  const days: string[] = [];
  for (let i = MOVEMENT_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const movementsChartConfig = {
  increase: { label: "Stock in", color: "var(--signal)" },
  decrease: { label: "Stock out", color: "var(--chart-3)" },
} satisfies ChartConfig;

function Dashboard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;

  const summary = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const today = now.toISOString().slice(0, 10);
      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - (MOVEMENT_DAYS - 1));
      windowStart.setHours(0, 0, 0, 0);

      const [
        products,
        levels,
        alerts,
        movements14d,
        purchaseOrders,
        gstPurchases,
        openPoItems,
        salesToday,
      ] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, sku, cost_price, reorder_point")
          .eq("org_id", orgId!),
        supabase
          .from("stock_levels")
          .select("product_id, quantity, reserved, damaged, expired")
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
          .select("type, quantity, created_at")
          .eq("org_id", orgId!)
          .gte("created_at", windowStart.toISOString()),
        supabase
          .from("purchase_orders")
          .select("id, po_number, status, expected_delivery_date, suppliers(name)")
          .eq("org_id", orgId!),
        supabase
          .from("purchase_orders")
          .select("id, cgst_amount, sgst_amount, igst_amount, suppliers(gst_number)")
          .eq("org_id", orgId!)
          .gte("order_date", monthStart),
        supabase
          .from("purchase_order_items")
          .select("quantity, received_quantity, purchase_orders(status)")
          .eq("org_id", orgId!),
        supabase
          .from("sales_orders")
          .select("total_amount, status")
          .eq("org_id", orgId!)
          .eq("order_date", today),
      ]);

      const productList = products.data ?? [];
      const levelList = levels.data ?? [];
      const qtyByProduct = new Map<string, number>();
      let reservedTotal = 0;
      let damagedTotal = 0;
      let expiredTotal = 0;
      for (const l of levelList) {
        qtyByProduct.set(l.product_id, (qtyByProduct.get(l.product_id) ?? 0) + Number(l.quantity));
        reservedTotal += Number(l.reserved);
        damagedTotal += Number(l.damaged);
        expiredTotal += Number(l.expired);
      }
      const unitsOnHand = [...qtyByProduct.values()].reduce((a, b) => a + b, 0);

      const incomingTotal = (openPoItems.data ?? []).reduce(
        (
          sum: number,
          item: {
            quantity: number;
            received_quantity: number;
            purchase_orders: { status: string } | null;
          },
        ) => {
          const status = item.purchase_orders?.status;
          if (!status || !INCOMING_PO_STATUSES.has(status)) return sum;
          const outstanding = Number(item.quantity) - Number(item.received_quantity);
          return outstanding > 0 ? sum + outstanding : sum;
        },
        0,
      );

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

      const openPOs = (purchaseOrders.data ?? []).filter((po) => OPEN_PO_STATUSES.has(po.status));
      const overduePOs = openPOs.filter(
        (po) => po.expected_delivery_date && po.expected_delivery_date < today,
      );

      const salesTodayTotal = (salesToday.data ?? [])
        .filter((so: { status: string }) => so.status !== "draft" && so.status !== "cancelled")
        .reduce((sum: number, so: { total_amount: number }) => sum + Number(so.total_amount), 0);

      const gstRows = gstPurchases.data ?? [];
      const gstRiskCount = gstRows.filter((po) => !isValidGstin(po.suppliers?.gst_number)).length;
      const cgstThisMonth = gstRows.reduce((s, po) => s + Number(po.cgst_amount), 0);
      const sgstThisMonth = gstRows.reduce((s, po) => s + Number(po.sgst_amount), 0);
      const igstThisMonth = gstRows.reduce((s, po) => s + Number(po.igst_amount), 0);
      const gstPayableThisMonth = cgstThisMonth + sgstThisMonth + igstThisMonth;

      const byDay = new Map(last14DayKeys().map((day) => [day, { increase: 0, decrease: 0 }]));
      for (const m of movements14d.data ?? []) {
        const day = m.created_at.slice(0, 10);
        const bucket = byDay.get(day);
        if (!bucket) continue;
        if (INCREASE_TYPES.has(m.type)) bucket.increase += Number(m.quantity);
        else bucket.decrease += Number(m.quantity);
      }
      const movementTrend = [...byDay.entries()].map(([day, v]) => ({
        day,
        label: new Date(day).getDate(),
        ...v,
      }));

      return {
        productCount: productList.length,
        stockValue,
        units: unitsOnHand,
        reserved: reservedTotal,
        incoming: incomingTotal,
        available: unitsOnHand - reservedTotal - damagedTotal - expiredTotal,
        healthy,
        low,
        stockout,
        lowStock,
        pendingPurchases: openPOs.length,
        overduePOs,
        alerts: alerts.data ?? [],
        movementTrend,
        gstRiskCount,
        cgstThisMonth,
        sgstThisMonth,
        igstThisMonth,
        gstPayableThisMonth,
        salesTodayTotal,
      };
    },
  });

  const data = summary.data;

  return (
    <AppShell
      title="Operations dashboard"
      description={org ? `${org.name} · live across all warehouses` : "Loading business…"}
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
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
        <Kpi
          label="Sales today"
          value={data ? inr.format(data.salesTodayTotal) : undefined}
          icon={<TrendingUp className="size-4 text-signal" />}
        />
      </div>

      <Card className="mt-4 sm:mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily brief</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!data ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{buildBrief(org?.name, data)}</p>

              <ProportionalBar
                segments={[
                  {
                    key: "healthy",
                    label: "Healthy",
                    value: data.healthy,
                    colorClass: "bg-signal",
                  },
                  { key: "low", label: "Low stock", value: data.low, colorClass: "bg-warn" },
                  {
                    key: "stockout",
                    label: "Out of stock",
                    value: data.stockout,
                    colorClass: "bg-destructive",
                  },
                ]}
              />

              {data.gstPayableThisMonth > 0 ? (
                <div className="border-t border-border pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      GST paid this month
                    </p>
                    <Link
                      to="/gst-filing"
                      className="flex items-center gap-1 text-xs font-medium text-signal hover:underline"
                    >
                      View filing <ArrowRight className="size-3" />
                    </Link>
                  </div>
                  <ProportionalBar
                    segments={[
                      {
                        key: "cgst",
                        label: "CGST",
                        value: data.cgstThisMonth,
                        colorClass: "bg-signal",
                        displayValue: inr.format(data.cgstThisMonth),
                      },
                      {
                        key: "sgst",
                        label: "SGST",
                        value: data.sgstThisMonth,
                        colorClass: "bg-chart-3",
                        displayValue: inr.format(data.sgstThisMonth),
                      },
                      {
                        key: "igst",
                        label: "IGST",
                        value: data.igstThisMonth,
                        colorClass: "bg-warn",
                        displayValue: inr.format(data.igstThisMonth),
                      },
                    ]}
                  />
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 sm:mt-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
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
          <CardHeader className="pb-2">
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
                      Set up your business's GST profile
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
                    className="flex items-start justify-between gap-3 text-sm hover:underline"
                  >
                    <p className="min-w-0 font-medium">
                      {data.gstRiskCount} purchase{data.gstRiskCount === 1 ? "" : "s"} this month{" "}
                      {data.gstRiskCount === 1 ? "has" : "have"} a missing/invalid supplier GSTIN
                    </p>
                    <Badge variant="destructive" className="mt-0.5 shrink-0">
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
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stock movement (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[160px] w-full" />
            ) : data.movementTrend.every((d) => d.increase === 0 && d.decrease === 0) ? (
              <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
            ) : (
              <ChartContainer
                config={movementsChartConfig}
                className="aspect-auto h-[160px] w-full"
              >
                <BarChart data={data.movementTrend} barGap={2} margin={{ left: -20 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval={2}
                    tickMargin={6}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload ? formatDate(payload[0].payload.day) : ""
                        }
                      />
                    }
                  />
                  <Bar dataKey="increase" fill="var(--color-increase)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="decrease" fill="var(--color-decrease)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-signal" /> Stock in
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-3" /> Stock out
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function ProportionalBar({
  segments,
}: {
  segments: {
    key: string;
    label: string;
    value: number;
    colorClass: string;
    displayValue?: string;
  }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  return (
    <div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
        {total === 0
          ? null
          : visible.map((s) => (
              <div
                key={s.key}
                className={cn("h-full rounded-[2px]", s.colorClass)}
                style={{ flexGrow: s.value, flexBasis: 0 }}
              />
            ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
            <span className={cn("size-2 shrink-0 rounded-full", s.colorClass)} />
            {s.label}:{" "}
            <span className="font-medium text-foreground">{s.displayValue ?? s.value}</span>
          </span>
        ))}
      </div>
    </div>
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
    `${orgName ?? "Your business"}'s inventory is worth ${inr.format(data.stockValue)} across ${num.format(data.productCount)} products.`,
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
      <CardContent className="p-3.5 sm:p-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            {label}
          </p>
          {icon}
        </div>
        {value === undefined ? (
          <Skeleton className="mt-3 h-7 w-20 sm:h-8 sm:w-24" />
        ) : (
          <p className="mt-2 font-display text-lg font-bold tracking-tight sm:text-2xl">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
