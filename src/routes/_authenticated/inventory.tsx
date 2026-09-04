import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { num } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { ScanInput } from "@/components/scan-input";
import { resolveProductByScan } from "@/lib/barcode-scan";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — StockPilot" },
      { name: "description", content: "Live stock levels across every warehouse." },
    ],
  }),
  component: Inventory,
});

type MovementType = Database["public"]["Enums"]["movement_type"];

const MOVEMENT_TYPES: { value: MovementType; label: string }[] = [
  { value: "inbound", label: "Inbound (receive stock)" },
  { value: "outbound", label: "Outbound (sale/dispatch)" },
  { value: "adjustment", label: "Adjustment (correction)" },
  { value: "reserve", label: "Reserve (hold for an order)" },
  { value: "unreserve", label: "Unreserve (release hold)" },
  { value: "damage", label: "Damage (flag as damaged)" },
  { value: "expired", label: "Expired" },
  { value: "return", label: "Return" },
  { value: "transfer_in", label: "Transfer in" },
  { value: "transfer_out", label: "Transfer out" },
];

// A PO's ordered-but-not-yet-received quantity counts as "incoming" once
// it's a confirmed order the supplier is acting on, not while it's still a
// draft or awaiting approval.
const INCOMING_PO_STATUSES = new Set(["approved", "sent", "partially_received"]);

function incomingKey(productId: string, warehouseId: string) {
  return `${productId}:${warehouseId}`;
}

const emptyForm = {
  product_id: "",
  warehouse_id: "",
  type: "inbound" as MovementType,
  quantity: "",
  reference: "",
  notes: "",
};

function Inventory() {
  const { org } = useCurrentOrg();
  const { can } = usePermissions();
  const canEdit = can("inventory.edit");
  const orgId = org?.id;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [adjustingRow, setAdjustingRow] = useState<{ product: string; warehouse: string } | null>(
    null,
  );

  const stockLevels = useQuery({
    queryKey: ["stock_levels", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_levels")
        .select("*, products(name, sku, reorder_point), warehouses(name, code)")
        .eq("org_id", orgId!)
        .order("updated_at", { ascending: false });
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
        .select("id, name, sku, barcode")
        .eq("org_id", orgId!)
        .eq("status", "active")
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

  // "Incoming" isn't part of the movement ledger — nothing has physically
  // moved yet — so it's derived from open purchase orders' outstanding
  // (ordered - received) quantity per product/warehouse, not stored.
  const incomingByKey = useQuery({
    queryKey: ["incoming-stock", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("product_id, quantity, received_quantity, purchase_orders(status, warehouse_id)")
        .eq("org_id", orgId!);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const item of data ?? []) {
        const po = item.purchase_orders;
        if (!po || !INCOMING_PO_STATUSES.has(po.status)) continue;
        const outstanding = Number(item.quantity) - Number(item.received_quantity);
        if (outstanding <= 0) continue;
        const key = incomingKey(item.product_id, po.warehouse_id);
        map.set(key, (map.get(key) ?? 0) + outstanding);
      }
      return map;
    },
  });

  const recordMovement = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      const { error } = await supabase.from("stock_movements").insert({
        org_id: orgId!,
        product_id: form.product_id,
        warehouse_id: form.warehouse_id,
        type: form.type,
        quantity: Number(form.quantity),
        reference: form.reference || null,
        notes: form.notes || null,
        created_by: userData.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock movement recorded");
      setOpen(false);
      setForm(emptyForm);
      setAdjustingRow(null);
      queryClient.invalidateQueries({ queryKey: ["stock_levels", orgId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not record movement"),
  });

  const handleScanProduct = (value: string) => {
    const product = resolveProductByScan(products.data ?? [], value);
    if (!product) {
      toast.error(`No product found for "${value}". Search for it manually instead.`);
      return;
    }
    setForm((f) => ({ ...f, product_id: product.id }));
  };

  const startEdit = (row: NonNullable<typeof stockLevels.data>[number]) => {
    setForm({
      ...emptyForm,
      product_id: row.product_id,
      warehouse_id: row.warehouse_id,
      type: "adjustment",
    });
    setAdjustingRow({
      product: row.products?.name ?? "this product",
      warehouse: row.warehouses?.name ?? "this warehouse",
    });
    setOpen(true);
  };

  return (
    <AppShell
      title="Inventory"
      description="Live stock levels across every warehouse."
      actions={
        canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                onClick={() => {
                  setForm(emptyForm);
                  setAdjustingRow(null);
                }}
              >
                <Plus className="size-4" />
                Record movement
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {adjustingRow ? "Edit stock level" : "Record stock movement"}
                </DialogTitle>
              </DialogHeader>
              {adjustingRow ? (
                <p className="-mt-2 text-sm text-muted-foreground">
                  Stock on hand isn't edited directly — it's a running total of every movement, so
                  this posts a correcting movement for {adjustingRow.product} at{" "}
                  {adjustingRow.warehouse} instead.
                </p>
              ) : null}
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  recordMovement.mutate();
                }}
              >
                <ScanInput
                  onScan={handleScanProduct}
                  placeholder="Scan or type a product barcode / SKU"
                />
                <div className="space-y-2">
                  <Label htmlFor="mv-product">Product</Label>
                  <Select
                    value={form.product_id}
                    onValueChange={(v) => setForm((f) => ({ ...f, product_id: v }))}
                    required
                  >
                    <SelectTrigger id="mv-product">
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
                <div className="space-y-2">
                  <Label htmlFor="mv-warehouse">Warehouse</Label>
                  <Select
                    value={form.warehouse_id}
                    onValueChange={(v) => setForm((f) => ({ ...f, warehouse_id: v }))}
                    required
                  >
                    <SelectTrigger id="mv-warehouse">
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="mv-type">Type</Label>
                    <Select
                      value={form.type}
                      onValueChange={(v) => setForm((f) => ({ ...f, type: v as MovementType }))}
                    >
                      <SelectTrigger id="mv-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MOVEMENT_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mv-qty">Quantity</Label>
                    <Input
                      id="mv-qty"
                      type="number"
                      required
                      min={0.01}
                      step="0.01"
                      value={form.quantity}
                      onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mv-ref">Reference</Label>
                  <Input
                    id="mv-ref"
                    value={form.reference}
                    onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                    placeholder="PO-1001, order id, etc."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mv-notes">Notes</Label>
                  <Input
                    id="mv-notes"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={recordMovement.isPending || !form.product_id || !form.warehouse_id}
                  >
                    {recordMovement.isPending ? "Recording…" : "Record movement"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {stockLevels.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !stockLevels.data || stockLevels.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <ArrowLeftRight className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No stock recorded yet. Record your first movement to get started.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Damaged</TableHead>
                  <TableHead className="text-right">Expired</TableHead>
                  <TableHead className="text-right">Incoming</TableHead>
                  <TableHead className="text-right">In transit</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockLevels.data.map((row) => {
                  const available =
                    Number(row.quantity) -
                    Number(row.reserved) -
                    Number(row.damaged) -
                    Number(row.expired);
                  const incoming =
                    incomingByKey.data?.get(incomingKey(row.product_id, row.warehouse_id)) ?? 0;
                  const low =
                    row.products?.reorder_point != null &&
                    Number(row.quantity) <= Number(row.products.reorder_point);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.products?.name}{" "}
                        <span className="text-muted-foreground">({row.products?.sku})</span>
                      </TableCell>
                      <TableCell>{row.warehouses?.name}</TableCell>
                      <TableCell
                        className={`text-right ${low ? "font-semibold text-destructive" : ""}`}
                      >
                        {num.format(Number(row.quantity))}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {num.format(available)}
                      </TableCell>
                      <TableCell className="text-right">
                        {num.format(Number(row.reserved))}
                      </TableCell>
                      <TableCell className="text-right">
                        {num.format(Number(row.damaged))}
                      </TableCell>
                      <TableCell className="text-right">
                        {num.format(Number(row.expired))}
                      </TableCell>
                      <TableCell className="text-right">{num.format(incoming)}</TableCell>
                      <TableCell className="text-right">
                        {num.format(Number(row.in_transit))}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>
                            <Pencil className="size-4" />
                            Edit
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 sm:hidden">
            {stockLevels.data.map((row) => {
              const available =
                Number(row.quantity) -
                Number(row.reserved) -
                Number(row.damaged) -
                Number(row.expired);
              const incoming =
                incomingByKey.data?.get(incomingKey(row.product_id, row.warehouse_id)) ?? 0;
              const low =
                row.products?.reorder_point != null &&
                Number(row.quantity) <= Number(row.products.reorder_point);
              return (
                <div key={row.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.products?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.products?.sku} · {row.warehouses?.name}
                      </p>
                    </div>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(row)}
                        className="shrink-0"
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">On hand</p>
                      <p className={low ? "font-semibold text-destructive" : ""}>
                        {num.format(Number(row.quantity))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Available</p>
                      <p className="font-medium">{num.format(available)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Reserved</p>
                      <p>{num.format(Number(row.reserved))}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Damaged</p>
                      <p>{num.format(Number(row.damaged))}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Expired</p>
                      <p>{num.format(Number(row.expired))}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Incoming</p>
                      <p>{num.format(incoming)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">In transit</p>
                      <p>{num.format(Number(row.in_transit))}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
