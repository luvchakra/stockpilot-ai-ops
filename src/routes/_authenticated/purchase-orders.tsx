import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inr, formatDate } from "@/lib/format";

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

type LineItem = { product_id: string; quantity: string; unit_cost: string };

const emptyLine = (): LineItem => ({ product_id: "", quantity: "1", unit_cost: "0" });

function newPoNumber() {
  return `PO-${Date.now().toString(36).toUpperCase()}`;
}

function PurchaseOrders() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
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
    queryKey: ["suppliers", orgId, "active"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
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
    queryKey: ["products", orgId, "active"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, cost_price")
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

  const subtotal = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
    0,
  );
  const total = subtotal + (Number(taxAmount) || 0) + (Number(shippingAmount) || 0) - (Number(discountAmount) || 0);

  const resetCreateForm = () => {
    setSupplierId("");
    setWarehouseId("");
    setExpectedDelivery("");
    setNotes("");
    setTaxAmount("0");
    setDiscountAmount("0");
    setShippingAmount("0");
    setLines([emptyLine()]);
  };

  const createPo = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
      if (validLines.length === 0) throw new Error("Add at least one line item");

      const { data: po, error: poError } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: orgId!,
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          po_number: newPoNumber(),
          expected_delivery_date: expectedDelivery || null,
          notes: notes || null,
          subtotal,
          tax_amount: Number(taxAmount) || 0,
          discount_amount: Number(discountAmount) || 0,
          shipping_amount: Number(shippingAmount) || 0,
          total_amount: total,
        })
        .select()
        .single();
      if (poError) throw poError;

      const { error: itemsError } = await supabase.from("purchase_order_items").insert(
        validLines.map((l) => ({
          org_id: orgId!,
          purchase_order_id: po.id,
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost) || 0,
        })),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      toast.success("Purchase order created");
      setCreateOpen(false);
      resetCreateForm();
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create purchase order"),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PoStatus }) => {
      const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update purchase order"),
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

  return (
    <AppShell
      title="Purchase Orders"
      description="Create, approve and receive purchase orders."
      actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              New purchase order
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New purchase order</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createPo.mutate();
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
                    <div key={idx} className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
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
                                      unit_cost: product ? String(product.cost_price) : l.unit_cost,
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
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} ({p.sku})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-24 space-y-1">
                        <Label className="text-xs text-muted-foreground">Qty</Label>
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)),
                            )
                          }
                        />
                      </div>
                      <div className="w-28 space-y-1">
                        <Label className="text-xs text-muted-foreground">Unit cost</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unit_cost}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((l, i) => (i === idx ? { ...l, unit_cost: e.target.value } : l)),
                            )
                          }
                        />
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

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="po-tax">Tax</Label>
                  <Input
                    id="po-tax"
                    type="number"
                    min={0}
                    step="0.01"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                  />
                </div>
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
                <Button
                  type="submit"
                  disabled={createPo.isPending || !supplierId || !warehouseId}
                >
                  {createPo.isPending ? "Creating…" : "Create purchase order"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
        <div className="panel overflow-x-auto rounded-2xl border border-border">
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
                  <TableCell className="text-right">{inr.format(Number(po.total_amount))}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[po.status]}>{po.status.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {po.status === "draft" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateStatus.mutate({ id: po.id, status: "approved" })}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {po.status === "approved" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateStatus.mutate({ id: po.id, status: "sent" })}
                        >
                          Mark sent
                        </Button>
                      ) : null}
                      {po.status === "received" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateStatus.mutate({ id: po.id, status: "closed" })}
                        >
                          Close
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDetailId(po.id);
                          setReceiveQty({});
                        }}
                      >
                        View
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedPo?.po_number}</DialogTitle>
          </DialogHeader>
          {selectedPo ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant={STATUS_VARIANT[selectedPo.status]}>
                  {selectedPo.status.replace("_", " ")}
                </Badge>
                <span>{selectedPo.suppliers?.name}</span>
                <span>·</span>
                <span>{selectedPo.warehouses?.name}</span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    {["sent", "approved", "partially_received"].includes(selectedPo.status) ? (
                      <TableHead className="text-right">Receive</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.data ?? []).map((item) => {
                    const remaining = Number(item.quantity) - Number(item.received_quantity);
                    const canReceive = ["sent", "approved", "partially_received"].includes(
                      selectedPo.status,
                    );
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.products?.name}{" "}
                          <span className="text-muted-foreground">({item.products?.sku})</span>
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{item.received_quantity}</TableCell>
                        <TableCell className="text-right">{inr.format(Number(item.unit_cost))}</TableCell>
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

              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-display text-lg font-semibold">
                  {inr.format(Number(selectedPo.total_amount))}
                </span>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
