import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

export const Route = createFileRoute("/_authenticated/stock-transfers")({
  head: () => ({
    meta: [
      { title: "Stock Transfers — StockPilot" },
      {
        name: "description",
        content: "Move stock between warehouses with a full in-transit audit trail.",
      },
    ],
  }),
  component: StockTransfers,
});

type StStatus = Database["public"]["Enums"]["stock_transfer_status"];

const STATUS_VARIANT: Record<StStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  requested: "outline",
  approved: "outline",
  in_transit: "default",
  received: "secondary",
  completed: "secondary",
  cancelled: "destructive",
};

type LineItem = { product_id: string; quantity: string };
const emptyLine = (): LineItem => ({ product_id: "", quantity: "1" });

function newTransferNumber() {
  return `ST-${Date.now().toString(36).toUpperCase()}`;
}

const STAGES = [
  { key: "draft", label: "Draft" },
  { key: "requested", label: "Requested" },
  { key: "approved", label: "Approved" },
  { key: "in_transit", label: "In Transit" },
  { key: "received", label: "Received" },
  { key: "completed", label: "Completed" },
] as const;

function stageIndex(status: StStatus) {
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
}

function primaryAction(
  status: StStatus,
): { label: string; kind: "status"; next: StStatus } | { label: string; kind: "ship" } | null {
  switch (status) {
    case "draft":
      return { label: "Submit for approval", kind: "status", next: "requested" };
    case "requested":
      return { label: "Approve", kind: "status", next: "approved" };
    case "approved":
      return { label: "Mark in transit", kind: "ship" };
    case "received":
      return { label: "Complete", kind: "status", next: "completed" };
    default:
      return null;
  }
}

function StageStepper({ status }: { status: StStatus }) {
  if (status === "cancelled") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
        This stock transfer was cancelled.
      </div>
    );
  }

  const current = stageIndex(status);
  const lastIndex = STAGES.length - 1;

  return (
    <div className="flex items-start">
      {STAGES.map((stage, i) => {
        const complete = i < current;
        const active = i === current;
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

function StockTransfers() {
  const { org } = useCurrentOrg();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canEdit = can("stock_transfers.edit");
  const canApprove = can("stock_transfers.approve");
  const canReceivePermission = can("stock_transfers.receive");
  const canCancel = can("stock_transfers.cancel");
  const orgId = org?.id;
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [damagedQty, setDamagedQty] = useState<Record<string, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stock_transfers", orgId] });
    queryClient.invalidateQueries({ queryKey: ["stock_levels", orgId] });
  };

  const transfers = useQuery({
    queryKey: ["stock_transfers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transfers")
        .select(
          "*, source:warehouses!stock_transfers_source_warehouse_id_fkey(name), destination:warehouses!stock_transfers_destination_warehouse_id_fkey(name)",
        )
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
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
    queryKey: ["products_safe", orgId, "active"],
    enabled: !!orgId && canEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_safe")
        .select("id, name, sku, unit")
        .eq("org_id", orgId!)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const detail = useQuery({
    queryKey: ["stock_transfer_items", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transfer_items")
        .select("*, products(name, sku, unit)")
        .eq("stock_transfer_id", detailId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const selectedTransfer = transfers.data?.find((t) => t.id === detailId);
  const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0);

  const resetCreateForm = () => {
    setSourceWarehouseId("");
    setDestinationWarehouseId("");
    setNotes("");
    setLines([emptyLine()]);
  };

  const saveTransfer = useMutation({
    mutationFn: async () => {
      if (validLines.length === 0) throw new Error("Add at least one line item");
      if (sourceWarehouseId === destinationWarehouseId) {
        throw new Error("Source and destination warehouses must be different");
      }

      const payload = {
        source_warehouse_id: sourceWarehouseId,
        destination_warehouse_id: destinationWarehouseId,
        notes: notes || null,
      };

      let transferId = editingId;
      if (editingId) {
        const { error } = await supabase
          .from("stock_transfers")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;

        // Draft-only edit, so nothing has shipped against these lines yet —
        // safe to replace the whole set rather than diff it.
        const { error: delError } = await supabase
          .from("stock_transfer_items")
          .delete()
          .eq("stock_transfer_id", editingId);
        if (delError) throw delError;
      } else {
        const { data, error } = await supabase
          .from("stock_transfers")
          .insert({ org_id: orgId!, transfer_number: newTransferNumber(), ...payload })
          .select()
          .single();
        if (error) throw error;
        transferId = data.id;
      }

      const { error: itemsError } = await supabase.from("stock_transfer_items").insert(
        validLines.map((l) => ({
          org_id: orgId!,
          stock_transfer_id: transferId!,
          product_id: l.product_id,
          quantity: Number(l.quantity),
        })),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      toast.success(editingId ? "Stock transfer updated" : "Stock transfer created");
      setFormOpen(false);
      resetCreateForm();
      setEditingId(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save transfer"),
  });

  const startEdit = (t: NonNullable<typeof transfers.data>[number]) => {
    setSourceWarehouseId(t.source_warehouse_id);
    setDestinationWarehouseId(t.destination_warehouse_id);
    setNotes(t.notes ?? "");
    setEditingId(t.id);
    supabase
      .from("stock_transfer_items")
      .select("product_id, quantity")
      .eq("stock_transfer_id", t.id)
      .then(({ data }) => {
        setLines(
          data && data.length > 0
            ? data.map((i) => ({ product_id: i.product_id, quantity: String(i.quantity) }))
            : [emptyLine()],
        );
      });
    setFormOpen(true);
  };

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      extra,
    }: {
      id: string;
      status: StStatus;
      extra?: Record<string, unknown>;
    }) => {
      const { error } = await supabase
        .from("stock_transfers")
        .update({ status, ...extra })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update transfer"),
  });

  const shipTransfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("ship_stock_transfer", { _transfer_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer marked in transit");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not ship transfer"),
  });

  const cancelTransfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_stock_transfer", { _transfer_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock transfer cancelled");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not cancel transfer"),
  });

  const receiveItem = useMutation({
    mutationFn: async ({
      itemId,
      quantity,
      damaged,
    }: {
      itemId: string;
      quantity: number;
      damaged: number;
    }) => {
      const { error } = await supabase.rpc("receive_stock_transfer_item", {
        _item_id: itemId,
        _quantity: quantity,
        _damaged_quantity: damaged,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock received");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["stock_transfer_items", detailId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not receive stock"),
  });

  const runPrimaryAction = (t: NonNullable<typeof transfers.data>[number]) => {
    const action = primaryAction(t.status);
    if (!action) return;
    if (action.kind === "ship") {
      shipTransfer.mutate(t.id);
      return;
    }
    updateStatus.mutate({
      id: t.id,
      status: action.next,
      ...(action.next === "approved" && user?.id ? { extra: { approved_by: user.id } } : {}),
      ...(action.next === "completed" ? { extra: { completed_at: new Date().toISOString() } } : {}),
    });
  };

  const canRunPrimaryAction = (status: StStatus) => {
    if (status === "draft") return canEdit;
    if (status === "requested" || status === "approved") return canApprove;
    if (status === "received") return canReceivePermission;
    return false;
  };

  const actionsPending =
    updateStatus.isPending || shipTransfer.isPending || cancelTransfer.isPending;
  const CANCELLABLE_STATUSES = new Set<StStatus>(["draft", "requested", "approved", "in_transit"]);

  return (
    <AppShell
      title="Stock Transfers"
      description="Move stock between warehouses with a full in-transit audit trail."
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
                New stock transfer
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingId ? "Edit stock transfer" : "New stock transfer"}
                </DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveTransfer.mutate();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="st-source">Source warehouse</Label>
                    <Select value={sourceWarehouseId} onValueChange={setSourceWarehouseId}>
                      <SelectTrigger id="st-source">
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
                    <Label htmlFor="st-destination">Destination warehouse</Label>
                    <Select
                      value={destinationWarehouseId}
                      onValueChange={setDestinationWarehouseId}
                    >
                      <SelectTrigger id="st-destination">
                        <SelectValue placeholder="Select warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        {(warehouses.data ?? [])
                          .filter((w) => w.id !== sourceWarehouseId)
                          .map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="st-notes">Notes</Label>
                  <Textarea
                    id="st-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
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
                            onValueChange={(v) =>
                              setLines((ls) =>
                                ls.map((l, i) => (i === idx ? { ...l, product_id: v } : l)),
                              )
                            }
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

                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={
                      saveTransfer.isPending || !sourceWarehouseId || !destinationWarehouseId
                    }
                  >
                    {saveTransfer.isPending
                      ? "Saving…"
                      : editingId
                        ? "Save changes"
                        : "Create stock transfer"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {transfers.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !transfers.data || transfers.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <Truck className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No stock transfers yet. Create one to move stock between warehouses.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer #</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.transfer_number}</TableCell>
                    <TableCell className="font-medium">{t.source?.name}</TableCell>
                    <TableCell className="font-medium">{t.destination?.name}</TableCell>
                    <TableCell>{formatDate(t.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {t.status === "draft" && canEdit ? (
                          <Button variant="ghost" size="sm" onClick={() => startEdit(t)}>
                            <Pencil className="size-4" />
                            Edit
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDetailId(t.id);
                            setReceiveQty({});
                            setDamagedQty({});
                          }}
                        >
                          View
                        </Button>
                        {primaryAction(t.status) && canRunPrimaryAction(t.status) ? (
                          <Button
                            size="sm"
                            disabled={actionsPending}
                            onClick={() => runPrimaryAction(t)}
                          >
                            {primaryAction(t.status)!.label}
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
            {transfers.data.map((t) => (
              <div key={t.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {t.source?.name} → {t.destination?.name}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{t.transfer_number}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[t.status]} className="shrink-0">
                    {t.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p>{formatDate(t.created_at)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  {t.status === "draft" && canEdit ? (
                    <Button variant="ghost" size="sm" onClick={() => startEdit(t)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDetailId(t.id);
                      setReceiveQty({});
                      setDamagedQty({});
                    }}
                  >
                    View
                  </Button>
                  {primaryAction(t.status) && canRunPrimaryAction(t.status) ? (
                    <Button size="sm" disabled={actionsPending} onClick={() => runPrimaryAction(t)}>
                      {primaryAction(t.status)!.label}
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
              {selectedTransfer?.transfer_number}
              {selectedTransfer ? (
                <Badge variant={STATUS_VARIANT[selectedTransfer.status]}>
                  {selectedTransfer.status.replace("_", " ")}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {selectedTransfer ? (
            <div className="space-y-5">
              <StageStepper status={selectedTransfer.status} />

              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Source</p>
                  <p className="font-medium">{selectedTransfer.source?.name}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Destination
                  </p>
                  <p className="font-medium">{selectedTransfer.destination?.name}</p>
                </div>
                {selectedTransfer.notes ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                    <p className="font-medium">{selectedTransfer.notes}</p>
                  </div>
                ) : null}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Damaged</TableHead>
                      {selectedTransfer.status === "in_transit" && canReceivePermission ? (
                        <TableHead className="text-right">Receive</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detail.data ?? []).map((item) => {
                      const remaining =
                        Number(item.quantity) -
                        Number(item.received_quantity) -
                        Number(item.damaged_quantity);
                      const canReceive =
                        canReceivePermission && selectedTransfer.status === "in_transit";
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            {item.products?.name}{" "}
                            <span className="text-muted-foreground">({item.products?.sku})</span>
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{item.received_quantity}</TableCell>
                          <TableCell className="text-right">{item.damaged_quantity}</TableCell>
                          {canReceive ? (
                            <TableCell className="text-right">
                              {remaining <= 0 ? (
                                <span className="text-xs text-muted-foreground">Complete</span>
                              ) : (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    type="number"
                                    min={0}
                                    max={remaining}
                                    step="0.01"
                                    className="h-8 w-16"
                                    placeholder="Good"
                                    value={receiveQty[item.id] ?? ""}
                                    onChange={(e) =>
                                      setReceiveQty((q) => ({ ...q, [item.id]: e.target.value }))
                                    }
                                  />
                                  <Input
                                    type="number"
                                    min={0}
                                    max={remaining}
                                    step="0.01"
                                    className="h-8 w-16"
                                    placeholder="Dmg"
                                    value={damagedQty[item.id] ?? ""}
                                    onChange={(e) =>
                                      setDamagedQty((q) => ({ ...q, [item.id]: e.target.value }))
                                    }
                                  />
                                  <Button
                                    size="sm"
                                    disabled={receiveItem.isPending}
                                    onClick={() => {
                                      const good = Number(receiveQty[item.id] || 0);
                                      const damaged = Number(damagedQty[item.id] || 0);
                                      if (good > 0 || damaged > 0) {
                                        receiveItem.mutate({
                                          itemId: item.id,
                                          quantity: good,
                                          damaged,
                                        });
                                        setReceiveQty((q) => ({ ...q, [item.id]: "" }));
                                        setDamagedQty((q) => ({ ...q, [item.id]: "" }));
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
                  const remaining =
                    Number(item.quantity) -
                    Number(item.received_quantity) -
                    Number(item.damaged_quantity);
                  const canReceive =
                    canReceivePermission && selectedTransfer.status === "in_transit";
                  return (
                    <div key={item.id} className="rounded-lg border border-border p-3">
                      <p className="font-medium">
                        {item.products?.name}{" "}
                        <span className="text-muted-foreground">({item.products?.sku})</span>
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Shipped</p>
                          <p>{item.quantity}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Received</p>
                          <p>{item.received_quantity}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Damaged</p>
                          <p>{item.damaged_quantity}</p>
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
                                placeholder="Good qty"
                                value={receiveQty[item.id] ?? ""}
                                onChange={(e) =>
                                  setReceiveQty((q) => ({ ...q, [item.id]: e.target.value }))
                                }
                              />
                              <Input
                                type="number"
                                min={0}
                                max={remaining}
                                step="0.01"
                                className="h-9 flex-1"
                                placeholder="Damaged qty"
                                value={damagedQty[item.id] ?? ""}
                                onChange={(e) =>
                                  setDamagedQty((q) => ({ ...q, [item.id]: e.target.value }))
                                }
                              />
                              <Button
                                size="sm"
                                disabled={receiveItem.isPending}
                                onClick={() => {
                                  const good = Number(receiveQty[item.id] || 0);
                                  const damaged = Number(damagedQty[item.id] || 0);
                                  if (good > 0 || damaged > 0) {
                                    receiveItem.mutate({
                                      itemId: item.id,
                                      quantity: good,
                                      damaged,
                                    });
                                    setReceiveQty((q) => ({ ...q, [item.id]: "" }));
                                    setDamagedQty((q) => ({ ...q, [item.id]: "" }));
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

              <div className="flex flex-wrap justify-end gap-2">
                {selectedTransfer.status === "draft" && canEdit ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDetailId(null);
                      startEdit(selectedTransfer);
                    }}
                  >
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                ) : null}
                {CANCELLABLE_STATUSES.has(selectedTransfer.status) && canCancel ? (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={actionsPending}
                    onClick={() => cancelTransfer.mutate(selectedTransfer.id)}
                  >
                    Cancel transfer
                  </Button>
                ) : null}
                {primaryAction(selectedTransfer.status) &&
                canRunPrimaryAction(selectedTransfer.status) ? (
                  <Button
                    size="lg"
                    disabled={actionsPending}
                    onClick={() => runPrimaryAction(selectedTransfer)}
                  >
                    {primaryAction(selectedTransfer.status)!.label}
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
