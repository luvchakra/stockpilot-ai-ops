import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Plus, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { usePermissions } from "@/hooks/usePermissions";

export const Route = createFileRoute("/_authenticated/sales-invoices")({
  head: () => ({
    meta: [
      { title: "Sales Invoices — StockPilot" },
      {
        name: "description",
        content: "Generate GST-compliant sales invoices and manage credit notes.",
      },
    ],
  }),
  component: SalesInvoices,
});

type PaymentStatus = Database["public"]["Enums"]["invoice_payment_status"];

const PAYMENT_STATUS_VARIANT: Record<PaymentStatus, "default" | "secondary" | "outline"> = {
  unpaid: "outline",
  partial: "secondary",
  paid: "default",
};

// A sales order is invoiceable once demand is confirmed and stock has
// started moving against it — matches generate_sales_invoice's own check
// in the migration, kept in sync here only for the eligible-orders list.
const INVOICEABLE_SO_STATUSES = new Set([
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "delivered",
]);

// customer_id/sales_order_id are NOT NULL FKs, so supabase-js infers
// these embeds as always-present.
type InvoiceRow = Database["public"]["Tables"]["sales_invoices"]["Row"] & {
  customers: { name: string };
  sales_orders: { so_number: string };
};
type InvoiceItemRow = Database["public"]["Tables"]["sales_invoice_items"]["Row"] & {
  products: { name: string; sku: string };
};
type CreditNoteRow = Database["public"]["Tables"]["credit_notes"]["Row"];
type EligibleSoOption = {
  id: string;
  so_number: string;
  status: string;
  customers: { name: string } | null;
};

function SalesInvoices() {
  const { org } = useCurrentOrg();
  const { can } = usePermissions();
  const canCreate = can("invoices.create");
  const canEdit = can("invoices.edit");
  const canCancel = can("invoices.cancel");
  const orgId = org?.id;
  const queryClient = useQueryClient();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedSoId, setSelectedSoId] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [creditKind, setCreditKind] = useState<"full" | "partial">("full");
  const [creditSubtotal, setCreditSubtotal] = useState("0");
  const [creditReason, setCreditReason] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sales_invoices", orgId] });
  };

  const invoices = useQuery({
    queryKey: ["sales_invoices", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("*, customers(name), sales_orders(so_number)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const eligibleSalesOrders = useQuery({
    queryKey: ["sales_orders", orgId, "invoiceable"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("id, so_number, status, customers(name)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const invoicedSoIds = new Set((invoices.data ?? []).map((inv: InvoiceRow) => inv.sales_order_id));
  const eligibleSos = (eligibleSalesOrders.data ?? []).filter(
    (so: EligibleSoOption) => INVOICEABLE_SO_STATUSES.has(so.status) && !invoicedSoIds.has(so.id),
  );

  const detail = useQuery({
    queryKey: ["sales_invoice_items", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select("*, products(name, sku)")
        .eq("invoice_id", detailId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const creditNotes = useQuery({
    queryKey: ["credit_notes", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_notes")
        .select("*")
        .eq("sales_invoice_id", detailId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as CreditNoteRow[];
    },
  });

  const selectedInvoice: InvoiceRow | undefined = invoices.data?.find(
    (inv: InvoiceRow) => inv.id === detailId,
  );
  const creditedSubtotal = (creditNotes.data ?? []).reduce(
    (sum, cn) => sum + Number(cn.subtotal),
    0,
  );
  const creditedTotal = (creditNotes.data ?? []).reduce(
    (sum, cn) => sum + Number(cn.total_amount),
    0,
  );
  const remainingSubtotal = selectedInvoice
    ? Number(selectedInvoice.subtotal) - creditedSubtotal
    : 0;
  const netPayable = selectedInvoice ? Number(selectedInvoice.total_amount) - creditedTotal : 0;

  const generateInvoice = useMutation({
    mutationFn: async () => {
      if (!selectedSoId) throw new Error("Select a sales order");
      const { data, error } = await supabase.rpc("generate_sales_invoice", {
        _so_id: selectedSoId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (invoiceId) => {
      toast.success("Invoice generated");
      setGenerateOpen(false);
      setSelectedSoId("");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sales_orders", orgId, "invoiceable"] });
      setDetailId(invoiceId as string);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not generate invoice"),
  });

  const updatePaymentStatus = useMutation({
    mutationFn: async ({ id, payment_status }: { id: string; payment_status: PaymentStatus }) => {
      const { error } = await supabase
        .from("sales_invoices")
        .update({ payment_status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update invoice"),
  });

  const createCreditNote = useMutation({
    mutationFn: async () => {
      if (!detailId) throw new Error("No invoice selected");
      const { error } = await supabase.rpc("create_credit_note", {
        _invoice_id: detailId,
        _is_full: creditKind === "full",
        ...(creditKind === "partial" ? { _subtotal: Number(creditSubtotal) } : {}),
        ...(creditReason ? { _reason: creditReason } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Credit note recorded");
      setCreditNoteOpen(false);
      setCreditKind("full");
      setCreditSubtotal("0");
      setCreditReason("");
      queryClient.invalidateQueries({ queryKey: ["credit_notes", detailId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not record credit note"),
  });

  return (
    <AppShell
      title="Sales Invoices"
      description="Generate GST-compliant invoices from sales orders and manage credit notes."
      actions={
        canCreate && (
          <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setSelectedSoId("")}>
                <Plus className="size-4" />
                New invoice
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate invoice</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  generateInvoice.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="inv-so">Sales order</Label>
                  <Select value={selectedSoId} onValueChange={setSelectedSoId}>
                    <SelectTrigger id="inv-so">
                      <SelectValue placeholder="Select a confirmed or shipped order" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleSos.map((so: EligibleSoOption) => (
                        <SelectItem key={so.id} value={so.id}>
                          {so.so_number} — {so.customers?.name} ({so.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {eligibleSos.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No orders are eligible yet — confirm a sales order first.
                    </p>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={generateInvoice.isPending || !selectedSoId}>
                    {generateInvoice.isPending ? "Generating…" : "Generate invoice"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      {invoices.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !invoices.data || invoices.data.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No invoices yet. Generate one from a confirmed sales order.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border panel sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Sales order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.data.map((inv: InvoiceRow) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                    <TableCell className="font-medium">{inv.customers?.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {inv.sales_orders?.so_number}
                    </TableCell>
                    <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                    <TableCell className="text-right">
                      {inr.format(Number(inv.total_amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={PAYMENT_STATUS_VARIANT[inv.payment_status]}>
                        {inv.payment_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setDetailId(inv.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 sm:hidden">
            {invoices.data.map((inv: InvoiceRow) => (
              <div key={inv.id} className="panel space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{inv.customers?.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</p>
                  </div>
                  <Badge variant={PAYMENT_STATUS_VARIANT[inv.payment_status]} className="shrink-0">
                    {inv.payment_status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p>{formatDate(inv.invoice_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="font-medium">{inr.format(Number(inv.total_amount))}</p>
                  </div>
                </div>
                <div className="flex justify-end border-t border-border pt-3">
                  <Button variant="outline" size="sm" onClick={() => setDetailId(inv.id)}>
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader className="no-print">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {selectedInvoice?.invoice_number}
              {selectedInvoice ? (
                <Badge variant={PAYMENT_STATUS_VARIANT[selectedInvoice.payment_status]}>
                  {selectedInvoice.payment_status}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice ? (
            <div className="space-y-5">
              <div className="print-area space-y-5">
                <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Seller</p>
                    <p className="font-medium">{org?.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{org?.gstin ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Buyer</p>
                    <p className="font-medium">{selectedInvoice.customers?.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {selectedInvoice.customer_gstin ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Invoice date
                    </p>
                    <p className="font-medium">{formatDate(selectedInvoice.invoice_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Sales order
                    </p>
                    <p className="font-mono text-xs font-medium">
                      {selectedInvoice.sales_orders?.so_number}
                    </p>
                  </div>
                  {selectedInvoice.billing_address ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Billing address
                      </p>
                      <p className="font-medium">{selectedInvoice.billing_address}</p>
                    </div>
                  ) : null}
                </div>

                <div className="hidden sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>HSN/SAC</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit price</TableHead>
                        <TableHead className="text-right">GST</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.data ?? []).map((item: InvoiceItemRow) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            {item.products?.name}{" "}
                            <span className="text-muted-foreground">({item.products?.sku})</span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.hsn_code ?? "—"}
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
                  {(detail.data ?? []).map((item: InvoiceItemRow) => (
                    <div key={item.id} className="rounded-lg border border-border p-3">
                      <p className="font-medium">
                        {item.products?.name}{" "}
                        <span className="text-muted-foreground">({item.products?.sku})</span>
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">HSN/SAC</p>
                          <p className="font-mono text-xs">{item.hsn_code ?? "—"}</p>
                        </div>
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
                    <span>{inr.format(Number(selectedInvoice.subtotal))}</span>
                  </div>
                  {Number(selectedInvoice.igst_amount) > 0 ? (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>IGST</span>
                      <span>{inr.format(Number(selectedInvoice.igst_amount))}</span>
                    </div>
                  ) : null}
                  {Number(selectedInvoice.cgst_amount) > 0 ? (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>CGST</span>
                      <span>{inr.format(Number(selectedInvoice.cgst_amount))}</span>
                    </div>
                  ) : null}
                  {Number(selectedInvoice.sgst_amount) > 0 ? (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>SGST</span>
                      <span>{inr.format(Number(selectedInvoice.sgst_amount))}</span>
                    </div>
                  ) : null}
                  {Number(selectedInvoice.shipping_amount) > 0 ? (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Shipping</span>
                      <span>{inr.format(Number(selectedInvoice.shipping_amount))}</span>
                    </div>
                  ) : null}
                  {Number(selectedInvoice.discount_amount) > 0 ? (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span>−{inr.format(Number(selectedInvoice.discount_amount))}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-border pt-1.5 font-display text-base font-semibold">
                    <span>Total</span>
                    <span>{inr.format(Number(selectedInvoice.total_amount))}</span>
                  </div>
                </div>

                {(creditNotes.data ?? []).length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Credit notes
                    </p>
                    <div className="space-y-2">
                      {(creditNotes.data ?? []).map((cn) => (
                        <div
                          key={cn.id}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <div>
                            <p className="font-mono text-xs font-medium">{cn.credit_note_number}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(cn.credit_note_date)}
                              {cn.reason ? ` · ${cn.reason}` : ""}
                            </p>
                          </div>
                          <span className="font-medium">
                            −{inr.format(Number(cn.total_amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 font-display text-base font-semibold">
                      <span>Net payable</span>
                      <span>{inr.format(netPayable)}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                {canEdit ? (
                  <Select
                    value={selectedInvoice.payment_status}
                    onValueChange={(v) =>
                      updatePaymentStatus.mutate({
                        id: selectedInvoice.id,
                        payment_status: v as PaymentStatus,
                      })
                    }
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="partial">Partially paid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={PAYMENT_STATUS_VARIANT[selectedInvoice.payment_status]}>
                    {selectedInvoice.payment_status}
                  </Badge>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => window.print()}>
                    <Printer className="size-4" />
                    Print
                  </Button>
                  {remainingSubtotal > 0 && canCancel ? (
                    <Dialog open={creditNoteOpen} onOpenChange={setCreditNoteOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline">Record credit note</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Record credit note</DialogTitle>
                        </DialogHeader>
                        <form
                          className="space-y-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            createCreditNote.mutate();
                          }}
                        >
                          <div className="space-y-2">
                            <Label htmlFor="cn-kind">Type</Label>
                            <Select
                              value={creditKind}
                              onValueChange={(v) => setCreditKind(v as "full" | "partial")}
                            >
                              <SelectTrigger id="cn-kind">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="full">
                                  Full — remaining {inr.format(remainingSubtotal)} + tax
                                </SelectItem>
                                <SelectItem value="partial">Partial</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {creditKind === "partial" ? (
                            <div className="space-y-2">
                              <Label htmlFor="cn-subtotal">Taxable value</Label>
                              <Input
                                id="cn-subtotal"
                                type="number"
                                min={0.01}
                                max={remainingSubtotal}
                                step="0.01"
                                value={creditSubtotal}
                                onChange={(e) => setCreditSubtotal(e.target.value)}
                              />
                              <p className="text-xs text-muted-foreground">
                                Up to {inr.format(remainingSubtotal)} remaining. Tax is credited
                                proportionally to the invoice's own rate.
                              </p>
                            </div>
                          ) : null}
                          <div className="space-y-2">
                            <Label htmlFor="cn-reason">Reason (optional)</Label>
                            <Textarea
                              id="cn-reason"
                              value={creditReason}
                              onChange={(e) => setCreditReason(e.target.value)}
                              placeholder="e.g. Damaged goods returned"
                            />
                          </div>
                          <DialogFooter>
                            <Button type="submit" disabled={createCreditNote.isPending}>
                              {createCreditNote.isPending ? "Saving…" : "Record credit note"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
