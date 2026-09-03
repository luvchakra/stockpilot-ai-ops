import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders — StockPilot" },
      { name: "description", content: "Create, approve and receive purchase orders." },
    ],
  }),
  component: PurchaseOrders,
});

type PoStatus = Database["public"]["Enums"]["po_status"];

const STATUS_VARIANT: Record<PoStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  pending_approval: "outline",
  approved: "outline",
  sent: "default",
  partially_received: "default",
  received: "secondary",
  closed: "secondary",
  cancelled: "destructive",
};

type LineItem = { product_id: string; quantity: string; unit_cost: string; tax_rate: string };

const emptyLine = (): LineItem => ({
  product_id: "",
  quantity: "1",
  unit_cost: "0",
  tax_rate: "0",
});

function newPoNumber() {
  return `PO-${Date.now().toString(36).toUpperCase()}`;
}

// The lifecycle stages the app's own actions actually walk a PO through.
// (`pending_approval` and `cancelled` exist in the schema but nothing in
// the UI sets them yet, so they're handled as fallbacks below rather than
// given their own step.)
const STAGES = [
  { key: "draft", label: "Draft" },
  { key: "approved", label: "Approved" },
  { key: "sent", label: "Sent" },
  { key: "received", label: "Received" },
  { key: "closed", label: "Closed" },
] as const;

function stageIndex(status: PoStatus) {
  if (status === "partially_received") return 3; // same column as "Received", shown in-progress
  if (status === "pending_approval") return 0;
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
}

// The one next-step action a PO's current status calls for, surfaced as a
// prominent primary button instead of being just another item in a row of
// equally-weighted buttons.
function primaryAction(status: PoStatus): { label: string; next: PoStatus } | null {
  switch (status) {
    case "draft":
      return { label: "Approve", next: "approved" };
    case "approved":
      return { label: "Mark as sent", next: "sent" };
    case "received":
      return { label: "Close order", next: "closed" };
    default:
      return null;
  }
}

function StageStepper({ status }: { status: PoStatus }) {
  if (status === "cancelled") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
        This purchase order was cancelled.
      </div>
    );
  }

  const current = stageIndex(status);
  const inProgress = status === "partially_received";
  const lastIndex = STAGES.length - 1;

  return (
    <div className="flex items-start">
      {STAGES.map((stage, i) => {
        const complete = i < current || (i === current && i === lastIndex && !inProgress);
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
                {active && inProgress ? " (in progress)" : ""}
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

function PurchaseOrders() {
  const { org } = useCurrentOrg();
  const { can } = usePermissions();
  const canEdit = can("purchase_orders.edit");
  const canApprove = can("purchase_orders.approve");
  const canReceivePermission = can("purchase_orders.receive");
  const orgId = org?.id;
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [shippingAmount, setShippingAmount] = useState("0");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase_orders", orgId] });
    queryClient.invalidateQueries({ queryKey: ["stock_levels", orgId] });
  };

  const purchaseOrders = useQuery({
    queryKey: ["purchase_orders", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*, suppliers(name), warehouses(name)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const suppliers = useQuery({
    queryKey: ["suppliers", orgId, "active", "gst"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, state, gst_number")
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

  // products_safe, not products directly, so a role without
  // inventory.view_cost never receives real cost_price over the wire, even
  // though only canEdit roles ever open this form (all of them also hold
  // inventory.view_cost, so nothing here actually gets masked today — this
  // is defense in depth for whenever that stops being true).
  const products = useQuery({
    queryKey: ["products_safe", orgId, "active", "gst"],
    enabled: !!orgId && canEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_safe")
        .select("id, name, sku, cost_price, tax_rate")
        .eq("org_id", orgId!)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const detail = useQuery({
    queryKey: ["purchase_order_items", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("*, products(name, sku)")
        .eq("purchase_order_id", detailId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const selectedPo = purchaseOrders.data?.find((po) => po.id === detailId);
  const selectedSupplier = suppliers.data?.find((s) => s.id === supplierId);
  const buyerStateCode = resolveStateCode(org?.state, org?.gstin);
  const sellerStateCode = resolveStateCode(selectedSupplier?.state, selectedSupplier?.gst_number);

  // Same filter the save mutation applies, computed once so the live total
  // shown here always matches what actually gets persisted.
  const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
  const lineGstFor = (l: LineItem) =>
    computeLineGst({
      taxableValue: (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
      gstRatePercent: Number(l.tax_rate) || 0,
      sellerStateCode,
      buyerStateCode,
    });
  const subtotal = validLines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
    0,
  );
  const gstTotals = aggregateGst(validLines.map(lineGstFor));
  const total =
    subtotal + gstTotals.totalTax + (Number(shippingAmount) || 0) - (Number(discountAmount) || 0);

  const resetCreateForm = () => {
    setSupplierId("");
    setWarehouseId("");
    setExpectedDelivery("");
    setNotes("");
    setDiscountAmount("0");
    setShippingAmount("0");
    setLines([emptyLine()]);
  };

  const savePo = useMutation({
    mutationFn: async () => {
      if (validLines.length === 0) throw new Error("Add at least one line item");

      const poPayload = {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        expected_delivery_date: expectedDelivery || null,
        notes: notes || null,
        subtotal,
        tax_amount: gstTotals.totalTax,
        cgst_amount: gstTotals.cgstAmount,
        sgst_amount: gstTotals.sgstAmount,
        igst_amount: gstTotals.igstAmount,
        discount_amount: Number(discountAmount) || 0,
        shipping_amount: Number(shippingAmount) || 0,
        total_amount: total,
      };

      let poId = editingId;
      if (editingId) {
        const { error: poError } = await supabase
          .from("purchase_orders")
          .update(poPayload)
          .eq("id", editingId);
        if (poError) throw poError;

        // Draft-only edit, so nothing has been received against these items
        // yet — safe to replace the whole set rather than diff it.
        const { error: delError } = await supabase
          .from("purchase_order_items")
          .delete()
          .eq("purchase_order_id", editingId);
        if (delError) throw delError;
      } else {
        const { data: po, error: poError } = await supabase
          .from("purchase_orders")
          .insert({ org_id: orgId!, po_number: newPoNumber(), ...poPayload })
          .select()
          .single();
        if (poError) throw poError;
        poId = po.id;
      }

      const { error: itemsError } = await supabase.from("purchase_order_items").insert(
        validLines.map((l) => {
          const breakup = lineGstFor(l);
          return {
            org_id: orgId!,
            purchase_order_id: poId!,
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_cost: Number(l.unit_cost) || 0,
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
      toast.success(editingId ? "Purchase order updated" : "Purchase order created");
      setFormOpen(false);
      resetCreateForm();
      if (editingId)
        queryClient.invalidateQueries({ queryKey: ["purchase_order_items", editingId] });
      setEditingId(null);
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not save purchase order"),
  });

  const startEdit = async (po: NonNullable<typeof purchaseOrders.data>[number]) => {
    const { data: items, error } = await supabase
      .from("purchase_order_items")
      .select("product_id, quantity, unit_cost, tax_rate")
      .eq("purchase_order_id", po.id)
      .order("created_at");
    if (error) {
      toast.error(error.message);
      return;
    }
    setSupplierId(po.supplier_id);
    setWarehouseId(po.warehouse_id);
    setExpectedDelivery(po.expected_delivery_date ?? "");
    setNotes(po.notes ?? "");
    setDiscountAmount(String(po.discount_amount ?? 0));
    setShippingAmount(String(po.shipping_amount ?? 0));
    setLines(
      items && items.length > 0
        ? items.map((it) => ({
            product_id: it.product_id,
            quantity: String(it.quantity),
            unit_cost: String(it.unit_cost),
            tax_rate: String(it.tax_rate ?? 0),
          }))
        : [emptyLine()],
    );
    setEditingId(po.id);
    setFormOpen(true);
  };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PoStatus }) => {
      const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not update purchase order"),
  });

  const receiveItem = useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) => {
      const { error } = await supabase.rpc("receive_purchase_order_item", {
        _item_id: itemId,
        _quantity: quantity,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock received");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["purchase_order_items", detailId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not receive stock"),
  });

  // draft->approved and approved->sent are the approval step; received->closed
  // is the receiving side's own wrap-up, so either permission covers it.
  const canPrimaryAction = (status: PoStatus) => {
    if (status === "draft" || status === "approved") return canApprove;
    if (status === "received") return canApprove || canReceivePermission;
    return false;
  };

  return (
    <AppShell
      title="Purchase Orders"
      description="Create, approve and receive purchase orders."
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
                New purchase order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingId ? "Edit purchase order" : "New purchase order"}
                </DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  savePo.mutate();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="po-supplier">Supplier</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger id="po-supplier">
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {(suppliers.data ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="po-warehouse">Receiving warehouse</Label>
                    <Select value={warehouseId} onValueChange={setWarehouseId}>
                      <SelectTrigger id="po-warehouse">
                        <SelectValue placeholder="Select warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        {(warehouses.data ?? []).map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="po-delivery">Expected delivery</Label>
                    <Input
                      id="po-delivery"
                      type="date"
                      value={expectedDelivery}
                      onChange={(e) => setExpectedDelivery(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="po-notes">Notes</Label>
                    <Input id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
                              const product = products.data?.find((p) => p.id === v);
                              setLines((ls) =>
                                ls.map((l, i) =>
                                  i === idx
                                    ? {
                                        ...l,
                                        product_id: v,
                                        unit_cost: product
                                          ? String(product.cost_price ?? 0)
                                          : l.unit_cost,
                                        tax_rate: product
                                          ? String(product.tax_rate ?? 0)
                                          : l.tax_rate,
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
                              {(products.data ?? []).map((p) => (
                                <SelectItem key={p.id} value={p.id!}>
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
                          <Label className="text-xs text-muted-foreground">Unit cost</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.unit_cost}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) =>
                                  i === idx ? { ...l, unit_cost: e.target.value } : l,
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

                {supplierId ? (
                  gstTotals.incomplete ? (
                    <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                      Can't compute GST for this order yet — set a state on this supplier and on
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
                    <Label htmlFor="po-discount">Discount</Label>
                    <Input
                      id="po-discount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="po-shipping">Shipping</Label>
                    <Input
                      id="po-shipping"
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
                  <Button type="submit" disabled={savePo.isPending || !supplierId || !warehouseId}>
                    {savePo.isPending
                      ? "Saving…"
                      : editingId
                        ? "Save changes"
                        : "Create purchase order"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {purchaseOrders.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !purchaseOrders.data || purchaseOrders.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <ClipboardList className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No purchase orders yet. Create your first one to start receiving stock.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Order date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.data.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-xs">{po.po_number}</TableCell>
                    <TableCell className="font-medium">{po.suppliers?.name}</TableCell>
                    <TableCell>{po.warehouses?.name}</TableCell>
                    <TableCell>{formatDate(po.order_date)}</TableCell>
                    <TableCell className="text-right">
                      {inr.format(Number(po.total_amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[po.status]}>
                        {po.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {po.status === "draft" && canEdit ? (
                          <Button variant="ghost" size="sm" onClick={() => startEdit(po)}>
                            <Pencil className="size-4" />
                            Edit
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDetailId(po.id);
                            setReceiveQty({});
                          }}
                        >
                          View
                        </Button>
                        {primaryAction(po.status) && canPrimaryAction(po.status) ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              updateStatus.mutate({
                                id: po.id,
                                status: primaryAction(po.status)!.next,
                              })
                            }
                          >
                            {primaryAction(po.status)!.label}
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
            {purchaseOrders.data.map((po) => (
              <div key={po.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{po.suppliers?.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{po.po_number}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[po.status]} className="shrink-0">
                    {po.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Warehouse</p>
                    <p className="truncate">{po.warehouses?.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Order date</p>
                    <p>{formatDate(po.order_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="font-medium">{inr.format(Number(po.total_amount))}</p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  {po.status === "draft" && canEdit ? (
                    <Button variant="ghost" size="sm" onClick={() => startEdit(po)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDetailId(po.id);
                      setReceiveQty({});
                    }}
                  >
                    View
                  </Button>
                  {primaryAction(po.status) && canPrimaryAction(po.status) ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        updateStatus.mutate({ id: po.id, status: primaryAction(po.status)!.next })
                      }
                    >
                      {primaryAction(po.status)!.label}
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
              {selectedPo?.po_number}
              {selectedPo ? (
                <Badge variant={STATUS_VARIANT[selectedPo.status]}>
                  {selectedPo.status.replace("_", " ")}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {selectedPo ? (
            <div className="space-y-5">
              <StageStepper status={selectedPo.status} />

              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Supplier</p>
                  <p className="font-medium">{selectedPo.suppliers?.name}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Warehouse</p>
                  <p className="font-medium">{selectedPo.warehouses?.name}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Order date
                  </p>
                  <p className="font-medium">{formatDate(selectedPo.order_date)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Expected delivery
                  </p>
                  <p className="font-medium">
                    {selectedPo.expected_delivery_date
                      ? formatDate(selectedPo.expected_delivery_date)
                      : "—"}
                  </p>
                </div>
                {selectedPo.notes ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                    <p className="font-medium">{selectedPo.notes}</p>
                  </div>
                ) : null}
              </div>

              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      {canReceivePermission &&
                      ["sent", "approved", "partially_received"].includes(selectedPo.status) ? (
                        <TableHead className="text-right">Receive</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detail.data ?? []).map((item) => {
                      const remaining = Number(item.quantity) - Number(item.received_quantity);
                      const canReceive =
                        canReceivePermission &&
                        ["sent", "approved", "partially_received"].includes(selectedPo.status);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            {item.products?.name}{" "}
                            <span className="text-muted-foreground">({item.products?.sku})</span>
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{item.received_quantity}</TableCell>
                          <TableCell className="text-right">
                            {inr.format(Number(item.unit_cost))}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {Number(item.tax_rate)}%
                          </TableCell>
                          {canReceive ? (
                            <TableCell className="text-right">
                              {remaining <= 0 ? (
                                <span className="text-xs text-muted-foreground">Complete</span>
                              ) : (
                                <div className="flex items-center justify-end gap-2">
                                  <Input
                                    type="number"
                                    min={0}
                                    max={remaining}
                                    step="0.01"
                                    className="h-8 w-20"
                                    placeholder={String(remaining)}
                                    value={receiveQty[item.id] ?? ""}
                                    onChange={(e) =>
                                      setReceiveQty((q) => ({ ...q, [item.id]: e.target.value }))
                                    }
                                  />
                                  <Button
                                    size="sm"
                                    disabled={receiveItem.isPending}
                                    onClick={() => {
                                      const qty = Number(receiveQty[item.id] || remaining);
                                      if (qty > 0) {
                                        receiveItem.mutate({ itemId: item.id, quantity: qty });
                                        setReceiveQty((q) => ({ ...q, [item.id]: "" }));
                                      }
                                    }}
                                  >
                                    Receive
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 sm:hidden">
                {(detail.data ?? []).map((item) => {
                  const remaining = Number(item.quantity) - Number(item.received_quantity);
                  const canReceive =
                    canReceivePermission &&
                    ["sent", "approved", "partially_received"].includes(selectedPo.status);
                  return (
                    <div key={item.id} className="rounded-lg border border-border p-3">
                      <p className="font-medium">
                        {item.products?.name}{" "}
                        <span className="text-muted-foreground">({item.products?.sku})</span>
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Ordered</p>
                          <p>{item.quantity}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Received</p>
                          <p>{item.received_quantity}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Unit cost</p>
                          <p>{inr.format(Number(item.unit_cost))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">GST</p>
                          <p>{Number(item.tax_rate)}%</p>
                        </div>
                      </div>
                      {canReceive ? (
                        <div className="mt-3 border-t border-border pt-3">
                          {remaining <= 0 ? (
                            <span className="text-xs text-muted-foreground">Complete</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={remaining}
                                step="0.01"
                                className="h-9 flex-1"
                                placeholder={String(remaining)}
                                value={receiveQty[item.id] ?? ""}
                                onChange={(e) =>
                                  setReceiveQty((q) => ({ ...q, [item.id]: e.target.value }))
                                }
                              />
                              <Button
                                size="sm"
                                disabled={receiveItem.isPending}
                                onClick={() => {
                                  const qty = Number(receiveQty[item.id] || remaining);
                                  if (qty > 0) {
                                    receiveItem.mutate({ itemId: item.id, quantity: qty });
                                    setReceiveQty((q) => ({ ...q, [item.id]: "" }));
                                  }
                                }}
                              >
                                Receive
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{inr.format(Number(selectedPo.subtotal))}</span>
                </div>
                {Number(selectedPo.igst_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>IGST</span>
                    <span>{inr.format(Number(selectedPo.igst_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedPo.cgst_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>CGST</span>
                    <span>{inr.format(Number(selectedPo.cgst_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedPo.sgst_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>SGST</span>
                    <span>{inr.format(Number(selectedPo.sgst_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedPo.tax_amount) > 0 &&
                Number(selectedPo.cgst_amount) === 0 &&
                Number(selectedPo.sgst_amount) === 0 &&
                Number(selectedPo.igst_amount) === 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Tax</span>
                    <span>{inr.format(Number(selectedPo.tax_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedPo.shipping_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Shipping</span>
                    <span>{inr.format(Number(selectedPo.shipping_amount))}</span>
                  </div>
                ) : null}
                {Number(selectedPo.discount_amount) > 0 ? (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span>−{inr.format(Number(selectedPo.discount_amount))}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-border pt-1.5 font-display text-base font-semibold">
                  <span>Total</span>
                  <span>{inr.format(Number(selectedPo.total_amount))}</span>
                </div>
              </div>

              {orgId ? (
                <EwayBillPanel
                  orgId={orgId}
                  sourceType="purchase_order"
                  sourceId={selectedPo.id}
                  totalValue={Number(selectedPo.total_amount)}
                  canGenerate={can("eway_bills.generate")}
                  canCancel={can("eway_bills.cancel")}
                />
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                {selectedPo.status === "draft" && canEdit ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDetailId(null);
                      startEdit(selectedPo);
                    }}
                  >
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                ) : null}
                {primaryAction(selectedPo.status) && canPrimaryAction(selectedPo.status) ? (
                  <Button
                    size="lg"
                    disabled={updateStatus.isPending}
                    onClick={() =>
                      updateStatus.mutate({
                        id: selectedPo.id,
                        status: primaryAction(selectedPo.status)!.next,
                      })
                    }
                  >
                    {primaryAction(selectedPo.status)!.label}
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
