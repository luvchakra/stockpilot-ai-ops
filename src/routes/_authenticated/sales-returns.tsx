import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Check, Plus, RotateCcw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { usePermissions } from "@/hooks/usePermissions";

const searchSchema = z.object({
  so: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/sales-returns")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sales Returns — StockPilot" },
      {
        name: "description",
        content: "Process customer returns, restock or credit-only, and issue credit notes.",
      },
    ],
  }),
  component: SalesReturns,
});

type SrStatus = Database["public"]["Enums"]["sales_return_status"];
type SrReason = Database["public"]["Enums"]["sales_return_reason"];

const STATUS_VARIANT: Record<SrStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  approved: "outline",
  completed: "default",
  cancelled: "destructive",
};

const REASON_LABEL: Record<SrReason, string> = {
  wrong_item: "Wrong item",
  damaged: "Damaged",
  changed_mind: "Changed mind",
  size_issue: "Size issue",
  quality_issue: "Quality issue",
  other: "Other",
};
const REASONS = Object.keys(REASON_LABEL) as SrReason[];

type SalesReturnRow = Database["public"]["Tables"]["sales_returns"]["Row"] & {
  sales_orders: { so_number: string; customers: { name: string } };
  credit_notes: { credit_note_number: string } | null;
};
type ReturnItemRow = Database["public"]["Tables"]["sales_return_items"]["Row"] & {
  products: { name: string; sku: string };
};
type EligibleSo = {
  id: string;
  so_number: string;
  customers: { name: string };
};
type SoItemForReturn = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  products: { name: string; sku: string };
};
type LineDraft = {
  product_id: string;
  name: string;
  sku: string;
  max_quantity: number;
  unit_price: number;
  quantity: string;
  reason: SrReason;
  restock: boolean;
  is_damaged: boolean;
};

const STAGES = [
  { key: "draft", label: "Draft" },
  { key: "approved", label: "Approved" },
  { key: "completed", label: "Completed" },
] as const;

function stageIndex(status: SrStatus) {
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
}

function primaryAction(
  status: SrStatus,
): { label: string; kind: "approve" } | { label: string; kind: "status"; next: SrStatus } | null {
  switch (status) {
    case "draft":
      return { label: "Approve return", kind: "approve" };
    case "approved":
      return { label: "Mark completed", kind: "status", next: "completed" };
    default:
      return null;
  }
}

function StageStepper({ status }: { status: SrStatus }) {
  if (status === "cancelled") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
        This sales return was cancelled.
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

function SalesReturns() {
  const { org } = useCurrentOrg();
  const { can } = usePermissions();
  const navigate = useNavigate({ from: "/sales-returns" });
  const search = Route.useSearch();
  const canCreate = can("sales_returns.create");
  const canApprove = can("sales_returns.approve");
  const canCancel = can("sales_returns.cancel");
  const orgId = org?.id;
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedSoId, setSelectedSoId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sales_returns", orgId] });
    queryClient.invalidateQueries({ queryKey: ["stock_levels", orgId] });
    queryClient.invalidateQueries({ queryKey: ["credit_notes", orgId] });
  };

  const returns = useQuery({
    queryKey: ["sales_returns", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_returns")
        .select("*, sales_orders(so_number, customers(name)), credit_notes(credit_note_number)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as SalesReturnRow[];
    },
  });

  const eligibleSos = useQuery({
    queryKey: ["sales_orders_returnable", orgId],
    enabled: !!orgId && canCreate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("id, so_number, customers(name)")
        .eq("org_id", orgId!)
        .in("status", ["shipped", "delivered"])
        .order("order_date", { ascending: false });
      if (error) throw error;
      return data as unknown as EligibleSo[];
    },
  });

  const soItems = useQuery({
    queryKey: ["sales_order_items_for_return", selectedSoId],
    enabled: !!selectedSoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_order_items")
        .select("id, product_id, quantity, unit_price, products(name, sku)")
        .eq("sales_order_id", selectedSoId)
        .order("created_at");
      if (error) throw error;
      return data as unknown as SoItemForReturn[];
    },
  });

  useEffect(() => {
    if (soItems.data) {
      setLines(
        soItems.data.map((i) => ({
          product_id: i.product_id,
          name: i.products.name,
          sku: i.products.sku,
          max_quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          quantity: "0",
          reason: "other",
          restock: true,
          is_damaged: false,
        })),
      );
    }
  }, [soItems.data]);

  useEffect(() => {
    if (search.so) {
      setSelectedSoId(search.so);
      setFormOpen(true);
    }
  }, [search.so]);

  const detail = useQuery({
    queryKey: ["sales_return_items", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_return_items")
        .select("*, products(name, sku)")
        .eq("sales_return_id", detailId!)
        .order("created_at");
      if (error) throw error;
      return data as unknown as ReturnItemRow[];
    },
  });

  const selectedReturn = returns.data?.find((r) => r.id === detailId);
  const activeLines = lines.filter((l) => Number(l.quantity) > 0);
  const returnValue = activeLines.reduce((sum, l) => sum + Number(l.quantity) * l.unit_price, 0);

  const resetForm = () => {
    setSelectedSoId("");
    setNotes("");
    setLines([]);
  };

  const createReturn = useMutation({
    mutationFn: async () => {
      if (!selectedSoId) throw new Error("Select a sales order");
      if (activeLines.length === 0) throw new Error("Add at least one returned line item");

      const returnNumber = await supabase.rpc("next_sales_return_number", { _org_id: orgId! });
      if (returnNumber.error) throw returnNumber.error;

      const { data: created, error } = await supabase
        .from("sales_returns")
        .insert({
          org_id: orgId!,
          sales_order_id: selectedSoId,
          return_number: returnNumber.data,
          notes: notes || null,
        })
        .select()
        .single();
      if (error) throw error;

      const { error: itemsError } = await supabase.from("sales_return_items").insert(
        activeLines.map((l) => ({
          org_id: orgId!,
          sales_return_id: created.id,
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_price: l.unit_price,
          reason: l.reason,
          restock: l.restock,
          is_damaged: l.restock ? l.is_damaged : false,
        })),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      toast.success("Sales return created");
      setFormOpen(false);
      resetForm();
      invalidate();
      if (search.so) void navigate({ search: {} });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create return"),
  });

  const approveReturn = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("approve_sales_return", { _return_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Return approved: stock and credit note posted");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not approve return"),
  });

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      extra,
    }: {
      id: string;
      status: SrStatus;
      extra?: Record<string, unknown>;
    }) => {
      const { error } = await supabase
        .from("sales_returns")
        .update({ status, ...extra })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update return"),
  });

  const cancelReturn = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sales_returns")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sales return cancelled");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not cancel return"),
  });

  const actionsPending =
    approveReturn.isPending || updateStatus.isPending || cancelReturn.isPending;

  const runPrimaryAction = (r: SalesReturnRow) => {
    const action = primaryAction(r.status);
    if (!action) return;
    if (action.kind === "approve") {
      approveReturn.mutate(r.id);
      return;
    }
    updateStatus.mutate({
      id: r.id,
      status: action.next,
      extra: { completed_at: new Date().toISOString() },
    });
  };

  const canRunPrimaryAction = (status: SrStatus) => {
    if (status === "draft" || status === "approved") return canApprove;
    return false;
  };

  return (
    <AppShell
      title="Sales Returns"
      description="Process customer returns, restock or credit-only, and issue credit notes."
      actions={
        canCreate && (
          <Dialog
            open={formOpen}
            onOpenChange={(v) => {
              setFormOpen(v);
              if (!v) {
                resetForm();
                if (search.so) void navigate({ search: {} });
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => resetForm()}>
                <Plus className="size-4" />
                New return
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New sales return</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createReturn.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="sr-so">Sales order</Label>
                  <Select value={selectedSoId} onValueChange={setSelectedSoId}>
                    <SelectTrigger id="sr-so">
                      <SelectValue placeholder="Select a shipped or delivered order" />
                    </SelectTrigger>
                    <SelectContent>
                      {(eligibleSos.data ?? []).map((so) => (
                        <SelectItem key={so.id} value={so.id}>
                          {so.so_number} — {so.customers.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {eligibleSos.data && eligibleSos.data.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No shipped or delivered orders are available to return against.
                    </p>
                  ) : null}
                </div>

                {selectedSoId && lines.length > 0 ? (
                  <div className="space-y-2">
                    <Label>Line items</Label>
                    <div className="space-y-3">
                      {lines.map((line, idx) => (
                        <div
                          key={line.product_id}
                          className="space-y-2 rounded-lg border border-border p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-sm font-medium">
                              {line.name}{" "}
                              <span className="text-muted-foreground">({line.sku})</span>
                            </p>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              Sold: {line.max_quantity}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="w-24 space-y-1">
                              <Label className="text-xs text-muted-foreground">Return qty</Label>
                              <Input
                                type="number"
                                min={0}
                                max={line.max_quantity}
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
                            <div className="min-w-40 flex-1 space-y-1">
                              <Label className="text-xs text-muted-foreground">Reason</Label>
                              <Select
                                value={line.reason}
                                onValueChange={(v) =>
                                  setLines((ls) =>
                                    ls.map((l, i) =>
                                      i === idx ? { ...l, reason: v as SrReason } : l,
                                    ),
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {REASONS.map((r) => (
                                    <SelectItem key={r} value={r}>
                                      {REASON_LABEL[r]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <label className="flex items-center gap-2 pb-1.5 text-sm">
                              <Checkbox
                                checked={line.restock}
                                onCheckedChange={(v) =>
                                  setLines((ls) =>
                                    ls.map((l, i) => (i === idx ? { ...l, restock: !!v } : l)),
                                  )
                                }
                              />
                              Restock
                            </label>
                            {line.restock ? (
                              <label className="flex items-center gap-2 pb-1.5 text-sm">
                                <Checkbox
                                  checked={line.is_damaged}
                                  onCheckedChange={(v) =>
                                    setLines((ls) =>
                                      ls.map((l, i) => (i === idx ? { ...l, is_damaged: !!v } : l)),
                                    )
                                  }
                                />
                                Damaged
                              </label>
                            ) : (
                              <span className="pb-1.5 text-xs text-muted-foreground">
                                Credit-only, no restock
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="sr-notes">Notes</Label>
                  <Textarea
                    id="sr-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                {activeLines.length > 0 ? (
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm">
                    <span className="text-muted-foreground">Return value (before GST)</span>
                    <span className="font-display text-base font-semibold">
                      {inr.format(returnValue)}
                    </span>
                  </div>
                ) : null}

                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createReturn.isPending || activeLines.length === 0}
                  >
                    {createReturn.isPending ? "Creating…" : "Create return"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {returns.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !returns.data || returns.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <RotateCcw className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No sales returns yet. Create one from a shipped or delivered order.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return #</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returns.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.return_number}</TableCell>
                    <TableCell className="font-medium">{r.sales_orders.so_number}</TableCell>
                    <TableCell>{r.sales_orders.customers.name}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDetailId(r.id)}>
                          View
                        </Button>
                        {primaryAction(r.status) && canRunPrimaryAction(r.status) ? (
                          <Button
                            size="sm"
                            disabled={actionsPending}
                            onClick={() => runPrimaryAction(r)}
                          >
                            {primaryAction(r.status)!.label}
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
            {returns.data.map((r) => (
              <div key={r.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.sales_orders.customers.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {r.return_number} · {r.sales_orders.so_number}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[r.status]} className="shrink-0">
                    {r.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p>{formatDate(r.created_at)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" onClick={() => setDetailId(r.id)}>
                    View
                  </Button>
                  {primaryAction(r.status) && canRunPrimaryAction(r.status) ? (
                    <Button size="sm" disabled={actionsPending} onClick={() => runPrimaryAction(r)}>
                      {primaryAction(r.status)!.label}
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
              {selectedReturn?.return_number}
              {selectedReturn ? (
                <Badge variant={STATUS_VARIANT[selectedReturn.status]}>
                  {selectedReturn.status}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {selectedReturn ? (
            <div className="space-y-5">
              <StageStepper status={selectedReturn.status} />

              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Sales order
                  </p>
                  <p className="font-medium">{selectedReturn.sales_orders.so_number}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer</p>
                  <p className="font-medium">{selectedReturn.sales_orders.customers.name}</p>
                </div>
                {selectedReturn.credit_notes ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Credit note
                    </p>
                    <p className="font-medium">{selectedReturn.credit_notes.credit_note_number}</p>
                  </div>
                ) : null}
                {selectedReturn.notes ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                    <p className="font-medium">{selectedReturn.notes}</p>
                  </div>
                ) : null}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Disposition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detail.data ?? []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.products.name}{" "}
                          <span className="text-muted-foreground">({item.products.sku})</span>
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {REASON_LABEL[item.reason]}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.restock
                            ? item.is_damaged
                              ? "Restock (damaged)"
                              : "Restock (good)"
                            : "Credit-only"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 sm:hidden">
                {(detail.data ?? []).map((item) => (
                  <div key={item.id} className="rounded-lg border border-border p-3">
                    <p className="font-medium">
                      {item.products.name}{" "}
                      <span className="text-muted-foreground">({item.products.sku})</span>
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Quantity</p>
                        <p>{item.quantity}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Reason</p>
                        <p>{REASON_LABEL[item.reason]}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Disposition</p>
                        <p>
                          {item.restock
                            ? item.is_damaged
                              ? "Restock (damaged)"
                              : "Restock (good)"
                            : "Credit-only"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {selectedReturn.status === "draft" && canCancel ? (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={actionsPending}
                    onClick={() => cancelReturn.mutate(selectedReturn.id)}
                  >
                    <X className="size-4" />
                    Cancel return
                  </Button>
                ) : null}
                {primaryAction(selectedReturn.status) &&
                canRunPrimaryAction(selectedReturn.status) ? (
                  <Button
                    size="lg"
                    disabled={actionsPending}
                    onClick={() => runPrimaryAction(selectedReturn)}
                  >
                    {primaryAction(selectedReturn.status)!.label}
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
