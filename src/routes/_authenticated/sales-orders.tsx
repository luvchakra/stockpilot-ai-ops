import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, Receipt, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { inr, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GST_RATE_SLABS, aggregateGst, computeLineGst, resolveStateCode } from "@/lib/gst";
import { usePermissions } from "@/hooks/usePermissions";
import { EwayBillPanel } from "@/components/eway-bill-panel";

export const Route = createFileRoute("/_authenticated/sales-orders")({
  head: () => ({
    meta: [
      { title: "Sales Orders — StockPilot" },
      { name: "description", content: "Create, confirm and fulfil sales orders." },
    ],
  }),
  component: SalesOrders,
});

type SoStatus = Database["public"]["Enums"]["so_status"];

const STATUS_VARIANT: Record<SoStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  confirmed: "outline",
  processing: "outline",
  packed: "outline",
  shipped: "default",
  delivered: "secondary",
  cancelled: "destructive",
  returned: "destructive",
};

type LineItem = { product_id: string; quantity: string; unit_price: string; tax_rate: string };

// customer_id/warehouse_id are NOT NULL FKs, so supabase-js infers these
// embeds as always-present (not nullable) — matched here so this type
// lines up with what `.select("*, customers(name), warehouses(name)")`
// actually produces.
type SalesOrderRow = Database["public"]["Tables"]["sales_orders"]["Row"] & {
  customers: { name: string };
  warehouses: { name: string };
};
type CustomerOption = { id: string; name: string; state: string | null; gstin: string | null };
type WarehouseOption = { id: string; name: string };
type ProductOption = {
  id: string;
  name: string;
  sku: string;
  selling_price: number;
  tax_rate: number;
};
type SalesOrderItemRow = Database["public"]["Tables"]["sales_order_items"]["Row"] & {
  products: { name: string; sku: string };
};
type SalesOrderItemFormRow = {
  product_id: string;
  quantity: number;
  unit_price: number;
  tax_rate: number | null;
};

const emptyLine = (): LineItem => ({
  product_id: "",
  quantity: "1",
  unit_price: "0",
  tax_rate: "0",
});

const STAGES = [
  { key: "draft", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "processing", label: "Processing" },
  { key: "packed", label: "Packed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
] as const;

function stageIndex(status: SoStatus) {
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
}

const CANCELLABLE_STATUSES = new Set(["draft", "confirmed", "processing", "packed"]);

type PrimaryAction =
  | { label: string; kind: "confirm" }
  | { label: string; kind: "ship" }
  | { label: string; kind: "status"; next: SoStatus };

// The one next-step action a sales order's current status calls for,
// surfaced as a prominent primary button. Confirm/ship carry real stock
// side effects (reserve; stock-out + release), so they go through
// dedicated RPCs rather than a plain status update.
function primaryAction(status: SoStatus): PrimaryAction | null {
  switch (status) {
    case "draft":
      return { label: "Confirm order", kind: "confirm" };
    case "confirmed":
      return { label: "Start processing", kind: "status", next: "processing" };
    case "processing":
      return { label: "Mark as packed", kind: "status", next: "packed" };
    case "packed":
      return { label: "Ship order", kind: "ship" };
    case "shipped":
      return { label: "Mark as delivered", kind: "status", next: "delivered" };
    default:
      return null;
  }
}

function StageStepper({ status }: { status: SoStatus }) {
  if (status === "cancelled" || status === "returned") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
        This sales order was {status}.
      </div>
    );
  }

  const current = stageIndex(status);
  const lastIndex = STAGES.length - 1;

  return (
    <div className="flex items-start">
      {STAGES.map((stage, i) => {
        const complete = i < current || (i === current && i === lastIndex);
        const active = i === current && !complete;
        return (
          <div key={stage.key} className="flex flex-1 items-start last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                  complete
                    ? "border-signal bg-signal text-signal-foreground"
                    : active
                      ? "border-signal text-signal"
                      : "border-border text-muted-foreground",
                )}
              >
                {complete ? <Check className="size-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-[11px] font-medium",
                  complete || active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {stage.label}
              </span>
            </div>
            {i < lastIndex ? (
              <div className={cn("mt-3.5 h-0.5 flex-1", i < current ? "bg-signal" : "bg-border")} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SalesOrders() {
  const { org } = useCurrentOrg();
  const { can } = usePermissions();
  const canEdit = can("sales_orders.edit");
  const canConfirm = can("sales_orders.confirm");
  const canShip = can("sales_orders.ship");
  const canCancel = can("sales_orders.cancel");
  const orgId = org?.id;
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedFulfillment, setExpectedFulfillment] = useState("");
  const [notes, setNotes] = useState("");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [shippingAmount, setShippingAmount] = useState("0");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  const [detailId, setDetailId] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sales_orders", orgId] });
    queryClient.invalidateQueries({ queryKey: ["stock_levels", orgId] });
  };

  const salesOrders = useQuery({
    queryKey: ["sales_orders", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("*, customers(name), warehouses(name)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const customers = useQuery({
    queryKey: ["customers", orgId, "active", "gst"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, state, gstin")
        .eq("org_id", orgId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const warehouses = useQuery({
    queryKey: ["warehouses", orgId, "active"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("org_id", orgId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const products = useQuery({
    queryKey: ["products", orgId, "active", "gst"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, selling_price, tax_rate")
        .eq("org_id", orgId!)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const detail = useQuery({
    queryKey: ["sales_order_items", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_order_items")
        .select("*, products(name, sku)")
        .eq("sales_order_id", detailId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const selectedSo: SalesOrderRow | undefined = salesOrders.data?.find(
    (so: SalesOrderRow) => so.id === detailId,
  );
  const selectedCustomer = customers.data?.find((c: CustomerOption) => c.id === customerId);
  const sellerStateCode = resolveStateCode(org?.state, org?.gstin);
  const buyerStateCode = resolveStateCode(selectedCustomer?.state, selectedCustomer?.gstin);

  const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
  const lineGstFor = (l: LineItem) =>
    computeLineGst({
      taxableValue: (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
      gstRatePercent: Number(l.tax_rate) || 0,
      sellerStateCode,
      buyerStateCode,
    });
  const subtotal = validLines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
    0,
  );
  const gstTotals = aggregateGst(validLines.map(lineGstFor));
  const total =
    subtotal + gstTotals.totalTax + (Number(shippingAmount) || 0) - (Number(discountAmount) || 0);

  const resetCreateForm = () => {
    setCustomerId("");
    setWarehouseId("");
    setExpectedFulfillment("");
    setNotes("");
    setDiscountAmount("0");
    setShippingAmount("0");
    setLines([emptyLine()]);
  };

  const saveSo = useMutation({
    mutationFn: async () => {
      if (validLines.length === 0) throw new Error("Add at least one line item");

      const soPayload = {
        customer_id: customerId,
        warehouse_id: warehouseId,
        expected_fulfillment_date: expectedFulfillment || null,
        notes: notes || null,
        subtotal,
        cgst_amount: gstTotals.cgstAmount,
        sgst_amount: gstTotals.sgstAmount,
        igst_amount: gstTotals.igstAmount,
        discount_amount: Number(discountAmount) || 0,
        shipping_amount: Number(shippingAmount) || 0,
        total_amount: total,
      };

      let soId = editingId;
      if (editingId) {
        const { error: soError } = await supabase
          .from("sales_orders")
          .update(soPayload)
          .eq("id", editingId);
        if (soError) throw soError;

        // Draft-only edit, so nothing has been reserved against these items
        // yet — safe to replace the whole set rather than diff it.
        const { error: delError } = await supabase
          .from("sales_order_items")
          .delete()
          .eq("sales_order_id", editingId);
        if (delError) throw delError;
      } else {
        const { data: number, error: numberError } = await supabase.rpc("next_sales_order_number", {
          _org_id: orgId!,
        });
        if (numberError) throw numberError;

        const { data: so, error: soError } = await supabase
          .from("sales_orders")
          .insert({ org_id: orgId!, so_number: number, ...soPayload })
          .select()
          .single();
        if (soError) throw soError;
        soId = so.id;
      }

      const { error: itemsError } = await supabase.from("sales_order_items").insert(
        validLines.map((l) => {
          const breakup = lineGstFor(l);
          return {
            org_id: orgId!,
            sales_order_id: soId!,
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price) || 0,
            tax_rate: Number(l.tax_rate) || 0,
            cgst_amount: breakup.cgstAmount,
            sgst_amount: breakup.sgstAmount,
            igst_amount: breakup.igstAmount,
          };
        }),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      toast.success(editingId ? "Sales order updated" : "Sales order created");
      setFormOpen(false);
      resetCreateForm();
      if (editingId) queryClient.invalidateQueries({ queryKey: ["sales_order_items", editingId] });
      setEditingId(null);
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not save sales order"),
  });

  const startEdit = async (so: NonNullable<typeof salesOrders.data>[number]) => {
    const { data: items, error } = await supabase
      .from("sales_order_items")
      .select("product_id, quantity, unit_price, tax_rate")
      .eq("sales_order_id", so.id)
      .order("created_at");
    if (error) {
      toast.error(error.message);
      return;
    }
    setCustomerId(so.customer_id);
    setWarehouseId(so.warehouse_id);
    setExpectedFulfillment(so.expected_fulfillment_date ?? "");
    setNotes(so.notes ?? "");
    setDiscountAmount(String(so.discount_amount ?? 0));
    setShippingAmount(String(so.shipping_amount ?? 0));
    setLines(
      items && items.length > 0
        ? items.map((it: SalesOrderItemFormRow) => ({
            product_id: it.product_id,
            quantity: String(it.quantity),
            unit_price: String(it.unit_price),
            tax_rate: String(it.tax_rate ?? 0),
          }))
        : [emptyLine()],
    );
    setEditingId(so.id);
    setFormOpen(true);
  };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SoStatus }) => {
      const { error } = await supabase.from("sales_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not update sales order"),
  });

  const confirmOrder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("confirm_sales_order", { _so_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Order confirmed — stock reserved");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not confirm order"),
  });

  const shipOrder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("ship_sales_order", { _so_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Order shipped");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not ship order"),
  });

  const cancelOrder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_sales_order", { _so_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Order cancelled");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not cancel order"),
  });

  const runPrimaryAction = (so: { id: string; status: SoStatus }) => {
    const action = primaryAction(so.status);
    if (!action) return;
    if (action.kind === "confirm") confirmOrder.mutate(so.id);
    else if (action.kind === "ship") shipOrder.mutate(so.id);
    else updateStatus.mutate({ id: so.id, status: action.next });
  };

  const actionsPending =
    updateStatus.isPending ||
    confirmOrder.isPending ||
    shipOrder.isPending ||
    cancelOrder.isPending;

  // draft->confirmed needs sales_orders.confirm; the fulfillment steps in
  // between (processing/packed) and the final ship are all floor work
  // gated by sales_orders.ship, matching the Warehouse Operator persona
  // (ships orders, doesn't confirm them).
  const canRunPrimaryAction = (status: SoStatus) => {
    const action = primaryAction(status);
    if (!action) return false;
    if (action.kind === "confirm") return canConfirm;
    return canShip;
  };

  return (
    <AppShell
      title="Sales Orders"
      description="Create, confirm and fulfil sales orders."
      actions={
        canEdit && (
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                onClick={() => {
                  resetCreateForm();
                  setEditingId(null);
                }}
              >
                <Plus className="size-4" />
                New sales order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit sales order" : "New sales order"}</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSo.mutate();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="so-customer">Customer</Label>
                    <Select value={customerId} onValueChange={setCustomerId}>
                      <SelectTrigger id="so-customer">
                        <SelectValue placeholder="Select customer" />
                      </SelectTrigger>
                      <SelectContent>
                        {(customers.data ?? []).map((c: CustomerOption) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="so-warehouse">Fulfilling warehouse</Label>
                    <Select value={warehouseId} onValueChange={setWarehouseId}>
                      <SelectTrigger id="so-warehouse">
                        <SelectValue placeholder="Select warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        {(warehouses.data ?? []).map((w: WarehouseOption) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="so-fulfillment">Expected fulfillment</Label>
                    <Input
                      id="so-fulfillment"
                      type="date"
                      value={expectedFulfillment}
                      onChange={(e) => setExpectedFulfillment(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="so-notes">Notes</Label>
                    <Input id="so-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Line items</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines((ls) => [...ls, emptyLine()])}
                    >
                      <Plus className="size-4" />
                      Add line
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {lines.map((line, idx) => (
                      <div key={idx} className="flex flex-wrap items-end gap-2">
                        <div className="w-full space-y-1 sm:min-w-0 sm:flex-1">
                          <Label className="text-xs text-muted-foreground">Product</Label>
                          <Select
                            value={line.product_id}
                            onValueChange={(v) => {
                              const product = products.data?.find((p: ProductOption) => p.id === v);
                              setLines((ls) =>
                                ls.map((l, i) =>
                                  i === idx
                                    ? {
                                        ...l,
                                        product_id: v,
                                        unit_price: product
                                          ? String(product.selling_price)
                                          : l.unit_price,
                                        tax_rate: product ? String(product.tax_rate) : l.tax_rate,
                                      }
                                    : l,
                                ),
                              );
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select product" />
                            </SelectTrigger>
                            <SelectContent>
                              {(products.data ?? []).map((p: ProductOption) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} ({p.sku})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-[4.5rem] space-y-1 sm:w-24">
                          <Label className="text-xs text-muted-foreground">Qty</Label>
                          <Input
                            type="number"
                            min={0.01}
                            step="0.01"
                            value={line.quantity}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) =>
                                  i === idx ? { ...l, quantity: e.target.value } : l,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="w-20 space-y-1 sm:w-28">
                          <Label className="text-xs text-muted-foreground">Unit price</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.unit_price}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) =>
                                  i === idx ? { ...l, unit_price: e.target.value } : l,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="w-20 space-y-1 sm:w-24">
                          <Label className="text-xs text-muted-foreground">GST %</Label>
                          <Select
                            value={line.tax_rate}
                            onValueChange={(v) =>
                              setLines((ls) =>
                                ls.map((l, i) => (i === idx ? { ...l, tax_rate: v } : l)),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {GST_RATE_SLABS.map((rate) => (
                                <SelectItem key={rate} value={String(rate)}>
                                  {rate}%
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={lines.length === 1}
                          onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {customerId ? (
                  gstTotals.incomplete ? (
                    <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                      Can't compute GST for this order yet — set a state on this customer and on
                      your business's GST profile (Account settings) so CGST/SGST vs. IGST can be
                      determined.
                    </p>
                  ) : (
                    <div className="space-y-1 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>
                          {gstTotals.igstAmount > 0
                            ? "IGST (interstate)"
                            : "CGST + SGST (intrastate)"}
                        </span>
                        <span>{inr.format(gstTotals.totalTax)}</span>
                      </div>
                      {gstTotals.igstAmount === 0 ? (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            CGST {inr.format(gstTotals.cgstAmount)} + SGST{" "}
                            {inr.format(gstTotals.sgstAmount)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="so-discount">Discount</Label>
                    <Input
                      id="so-discount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="so-shipping">Shipping</Label>
                    <Input
                      id="so-shipping"
                      type="number"
                      min={0}
                      step="0.01"
                      value={shippingAmount}
                      onChange={(e) => setShippingAmount(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-display text-lg font-semibold">{inr.format(total)}</span>
                </div>

                <DialogFooter>
                  <Button type="submit" disabled={saveSo.isPending || !customerId || !warehouseId}>
                    {saveSo.isPending
                      ? "Saving…"
                      : editingId
                        ? "Save changes"
                        : "Create sales order"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {salesOrders.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !salesOrders.data || salesOrders.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <Receipt className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No sales orders yet. Create your first one to record a sale.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SO number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Order date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesOrders.data.map((so: SalesOrderRow) => (
                  <TableRow key={so.id}>
                    <TableCell className="font-mono text-xs">{so.so_number}</TableCell>
                    <TableCell className="font-medium">{so.customers?.name}</TableCell>
                    <TableCell>{so.warehouses?.name}</TableCell>
                    <TableCell>{formatDate(so.order_date)}</TableCell>
                    <TableCell className="text-right">
                      {inr.format(Number(so.total_amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[so.status]}>{so.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDetailId(so.id)}>
                          View
                        </Button>
                        {primaryAction(so.status) && canRunPrimaryAction(so.status) ? (
                          <Button
                            size="sm"
                            disabled={actionsPending}
                            onClick={() => runPrimaryAction(so)}
                          >
                            {primaryAction(so.status)!.label}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 sm:hidden">
            {salesOrders.data.map((so: SalesOrderRow) => (
              <div key={so.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{so.customers?.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{so.so_number}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[so.status]} className="shrink-0">
                    {so.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Warehouse</p>
                    <p className="truncate">{so.warehouses?.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Order date</p>
                    <p>{formatDate(so.order_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="font-medium">{inr.format(Number(so.total_amount))}</p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" onClick={() => setDetailId(so.id)}>
                    View
                  </Button>
                  {primaryAction(so.status) && canRunPrimaryAction(so.status) ? (
                    <Button
                      size="sm"
                      disabled={actionsPending}
                      onClick={() => runPrimaryAction(so)}
                    >
                      {primaryAction(so.status)!.label}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {selectedSo?.so_number}
              {selectedSo ? (
                <Badge variant={STATUS_VARIANT[selectedSo.status]}>{selectedSo.status}</Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {selectedSo ? (
            <div className="space-y-5">
              <StageStepper status={selectedSo.status} />

              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer</p>
                  <p className="font-medium">{selectedSo.customers?.name}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Warehouse</p>
                  <p className="font-medium">{selectedSo.warehouses?.name}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Order date
                  </p>
                  <p className="font-medium">{formatDate(selectedSo.order_date)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Expected fulfillment
                  </p>
                  <p className="font-medium">
                    {selectedSo.expected_fulfillment_date
                      ? formatDate(selectedSo.expected_fulfillment_date)
                      : "—"}
                  </p>
                </div>
                {selectedSo.notes ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                    <p className="font-medium">{selectedSo.notes}</p>
                  </div>
                ) : null}
              </div>

              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detail.data ?? []).map((item: SalesOrderItemRow) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.products?.name}{" "}
                          <span className="text-muted-foreground">({item.products?.sku})</span>
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {inr.format(Number(item.unit_price))}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {Number(item.tax_rate)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 sm:hidden">
                {(detail.data ?? []).map((item: SalesOrderItemRow) => (
                  <div key={item.id} className="rounded-lg border border-border p-3">
                    <p className="font-medium">
                      {item.products?.name}{" "}
                      <span className="text-muted-foreground">({item.products?.sku})</span>
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Quantity</p>
                        <p>{item.quantity}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Unit price</p>
                        <p>{inr.format(Number(item.unit_price))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">GST</p>
                        <p>{Number(item.tax_rate)}%</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{inr.format(Number(selectedSo.subtotal))}</span>
                </div>
                {Number(selectedSo.igst_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>IGST</span>
                    <span>{inr.format(Number(selectedSo.igst_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedSo.cgst_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>CGST</span>
                    <span>{inr.format(Number(selectedSo.cgst_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedSo.sgst_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>SGST</span>
                    <span>{inr.format(Number(selectedSo.sgst_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedSo.shipping_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Shipping</span>
                    <span>{inr.format(Number(selectedSo.shipping_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedSo.discount_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span>−{inr.format(Number(selectedSo.discount_amount))}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-border pt-1.5 font-display text-base font-semibold">
                  <span>Total</span>
                  <span>{inr.format(Number(selectedSo.total_amount))}</span>
                </div>
              </div>

              {orgId ? (
                <EwayBillPanel
                  orgId={orgId}
                  sourceType="sales_order"
                  sourceId={selectedSo.id}
                  totalValue={Number(selectedSo.total_amount)}
                  canGenerate={can("eway_bills.generate")}
                  canCancel={can("eway_bills.cancel")}
                />
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                {selectedSo.status === "draft" && canEdit ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDetailId(null);
                      startEdit(selectedSo);
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
                {CANCELLABLE_STATUSES.has(selectedSo.status) && canCancel ? (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={actionsPending}
                    onClick={() => cancelOrder.mutate(selectedSo.id)}
                  >
                    <X className="size-4" />
                    Cancel order
                  </Button>
                ) : null}
                {primaryAction(selectedSo.status) && canRunPrimaryAction(selectedSo.status) ? (
                  <Button
                    size="lg"
                    disabled={actionsPending}
                    onClick={() => runPrimaryAction(selectedSo)}
                  >
                    {primaryAction(selectedSo.status)!.label}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
