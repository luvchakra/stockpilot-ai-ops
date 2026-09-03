import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileWarning, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/useOrg";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { inr, formatDate } from "@/lib/format";
import { isValidGstin } from "@/lib/gst";

export const Route = createFileRoute("/_authenticated/gst-filing")({
  head: () => ({
    meta: [
      { title: "GST Filing — StockPilot" },
      {
        name: "description",
        content:
          "Purchase register (GSTR-3B/2B) and sales register (GSTR-1 outward supply) for your monthly GST filing.",
      },
    ],
  }),
  component: GstFiling,
});

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodBounds(period: string) {
  const [yearStr, monthStr] = period.split("-");
  const year = Number(yearStr) || new Date().getFullYear();
  const month = Number(monthStr) || new Date().getMonth() + 1;
  const start = `${period}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${period}-${String(endDate).padStart(2, "0")}`;
  return { start, end };
}

function csvCell(value: string | number) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function GstFiling() {
  const { org } = useCurrentOrg();
  const orgId = org?.id;
  const [period, setPeriod] = useState(currentPeriod());
  const { start, end } = periodBounds(period);

  const purchases = useQuery({
    queryKey: ["gst_purchase_register", orgId, period],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: orders, error: ordersError } = await supabase
        .from("purchase_orders")
        .select(
          "id, po_number, order_date, status, subtotal, cgst_amount, sgst_amount, igst_amount, tax_amount, suppliers(name, gst_number)",
        )
        .eq("org_id", orgId!)
        .gte("order_date", start)
        .lte("order_date", end)
        .order("order_date", { ascending: true });
      if (ordersError) throw ordersError;

      const poIds = (orders ?? []).map((po) => po.id);
      if (poIds.length === 0)
        return orders?.map((po) => ({ ...po, purchase_order_items: [] })) ?? [];

      const { data: items, error: itemsError } = await supabase
        .from("purchase_order_items")
        .select(
          "purchase_order_id, quantity, unit_cost, cgst_amount, sgst_amount, igst_amount, products(hsn_code)",
        )
        .in("purchase_order_id", poIds);
      if (itemsError) throw itemsError;

      return (orders ?? []).map((po) => ({
        ...po,
        purchase_order_items: (items ?? []).filter((it) => it.purchase_order_id === po.id),
      }));
    },
  });

  const summary = useMemo(() => {
    const rows = purchases.data ?? [];
    let taxableValue = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    const bySupplier = new Map<
      string,
      {
        name: string;
        gstin: string | null;
        taxableValue: number;
        tax: number;
        risk: "none" | "missing" | "invalid";
      }
    >();
    const byHsn = new Map<string, { hsn: string; taxableValue: number; tax: number }>();

    for (const po of rows) {
      taxableValue += Number(po.subtotal);
      cgst += Number(po.cgst_amount);
      sgst += Number(po.sgst_amount);
      igst += Number(po.igst_amount);

      const supplierName = po.suppliers?.name ?? "Unknown supplier";
      const gstin = po.suppliers?.gst_number ?? null;
      const risk: "none" | "missing" | "invalid" = !gstin
        ? "missing"
        : !isValidGstin(gstin)
          ? "invalid"
          : "none";
      const supKey = supplierName + "|" + (gstin ?? "");
      const supEntry = bySupplier.get(supKey) ?? {
        name: supplierName,
        gstin,
        taxableValue: 0,
        tax: 0,
        risk,
      };
      supEntry.taxableValue += Number(po.subtotal);
      supEntry.tax += Number(po.cgst_amount) + Number(po.sgst_amount) + Number(po.igst_amount);
      bySupplier.set(supKey, supEntry);

      for (const item of po.purchase_order_items ?? []) {
        const hsn = item.products?.hsn_code || "Unassigned";
        const lineTaxable = Number(item.quantity) * Number(item.unit_cost);
        const lineTax =
          Number(item.cgst_amount) + Number(item.sgst_amount) + Number(item.igst_amount);
        const hsnEntry = byHsn.get(hsn) ?? { hsn, taxableValue: 0, tax: 0 };
        hsnEntry.taxableValue += lineTaxable;
        hsnEntry.tax += lineTax;
        byHsn.set(hsn, hsnEntry);
      }
    }

    return {
      poCount: rows.length,
      taxableValue,
      cgst,
      sgst,
      igst,
      totalTax: cgst + sgst + igst,
      bySupplier: [...bySupplier.values()].sort((a, b) => b.tax - a.tax),
      byHsn: [...byHsn.values()].sort((a, b) => b.tax - a.tax),
    };
  }, [purchases.data]);

  const exportRegister = () => {
    const rows: (string | number)[][] = [
      ["Purchase register / ITC summary", org?.name ?? "", period],
      [],
      [
        "PO number",
        "Order date",
        "Supplier",
        "Supplier GSTIN",
        "Taxable value",
        "CGST",
        "SGST",
        "IGST",
        "Total tax",
        "GSTIN status",
      ],
      ...(purchases.data ?? []).map((po) => {
        const supplierGstin = po.suppliers?.gst_number ?? null;
        const gstinStatus = !supplierGstin
          ? "No GSTIN — likely unregistered, check reverse charge"
          : !isValidGstin(supplierGstin)
            ? "Invalid GSTIN — verify with supplier"
            : "OK";
        return [
          po.po_number,
          po.order_date,
          po.suppliers?.name ?? "",
          supplierGstin ?? "",
          Number(po.subtotal),
          Number(po.cgst_amount),
          Number(po.sgst_amount),
          Number(po.igst_amount),
          Number(po.cgst_amount) + Number(po.sgst_amount) + Number(po.igst_amount),
          gstinStatus,
        ];
      }),
      [],
      ["HSN-wise summary"],
      ["HSN code", "Taxable value", "Tax"],
      ...summary.byHsn.map((h) => [h.hsn, h.taxableValue, h.tax]),
    ];
    downloadCsv(`gst-purchase-register-${period}.csv`, rows);
  };

  const salesInvoices = useQuery({
    queryKey: ["gst_sales_register", orgId, period],
    enabled: !!orgId,
    queryFn: async () => {
      const { data: invoices, error: invError } = await supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, invoice_date, subtotal, cgst_amount, sgst_amount, igst_amount, customer_gstin, customers(name, state)",
        )
        .eq("org_id", orgId!)
        .gte("invoice_date", start)
        .lte("invoice_date", end)
        .order("invoice_date", { ascending: true });
      if (invError) throw invError;

      const invoiceIds = (invoices ?? []).map((inv) => inv.id);
      const { data: items, error: itemsError } =
        invoiceIds.length === 0
          ? { data: [], error: null }
          : await supabase
              .from("sales_invoice_items")
              .select(
                "invoice_id, hsn_code, quantity, unit_price, cgst_amount, sgst_amount, igst_amount",
              )
              .in("invoice_id", invoiceIds);
      if (itemsError) throw itemsError;

      const { data: creditNotes, error: cnError } = await supabase
        .from("credit_notes")
        .select(
          "id, credit_note_number, credit_note_date, subtotal, cgst_amount, sgst_amount, igst_amount, sales_invoices(invoice_number)",
        )
        .eq("org_id", orgId!)
        .gte("credit_note_date", start)
        .lte("credit_note_date", end)
        .order("credit_note_date", { ascending: true });
      if (cnError) throw cnError;

      return {
        invoices: (invoices ?? []).map((inv) => ({
          ...inv,
          items: (items ?? []).filter((it) => it.invoice_id === inv.id),
        })),
        creditNotes: creditNotes ?? [],
      };
    },
  });

  const outwardSummary = useMemo(() => {
    const invoices = salesInvoices.data?.invoices ?? [];
    const creditNotes = salesInvoices.data?.creditNotes ?? [];
    let taxableValue = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let missingGstinCount = 0;
    let invalidGstinCount = 0;

    const b2b: Array<{
      invoiceNumber: string;
      invoiceDate: string;
      customerName: string;
      gstin: string;
      taxableValue: number;
      cgst: number;
      sgst: number;
      igst: number;
    }> = [];
    const b2c = new Map<string, { state: string; taxableValue: number; tax: number }>();
    const byHsn = new Map<string, { hsn: string; taxableValue: number; tax: number }>();

    for (const inv of invoices) {
      taxableValue += Number(inv.subtotal);
      cgst += Number(inv.cgst_amount);
      sgst += Number(inv.sgst_amount);
      igst += Number(inv.igst_amount);

      const gstin = inv.customer_gstin;
      const isB2B = !!gstin && isValidGstin(gstin);
      if (isB2B) {
        b2b.push({
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.invoice_date,
          customerName: inv.customers?.name ?? "Unknown",
          gstin: gstin!,
          taxableValue: Number(inv.subtotal),
          cgst: Number(inv.cgst_amount),
          sgst: Number(inv.sgst_amount),
          igst: Number(inv.igst_amount),
        });
      } else {
        if (!gstin) missingGstinCount++;
        else invalidGstinCount++;
        const state = inv.customers?.state || "Unknown";
        const entry = b2c.get(state) ?? { state, taxableValue: 0, tax: 0 };
        entry.taxableValue += Number(inv.subtotal);
        entry.tax += Number(inv.cgst_amount) + Number(inv.sgst_amount) + Number(inv.igst_amount);
        b2c.set(state, entry);
      }

      for (const item of inv.items ?? []) {
        const hsn = item.hsn_code || "Unassigned";
        const lineTaxable = Number(item.quantity) * Number(item.unit_price);
        const lineTax =
          Number(item.cgst_amount) + Number(item.sgst_amount) + Number(item.igst_amount);
        const hsnEntry = byHsn.get(hsn) ?? { hsn, taxableValue: 0, tax: 0 };
        hsnEntry.taxableValue += lineTaxable;
        hsnEntry.tax += lineTax;
        byHsn.set(hsn, hsnEntry);
      }
    }

    const creditTaxableValue = creditNotes.reduce((s, cn) => s + Number(cn.subtotal), 0);
    const creditTax = creditNotes.reduce(
      (s, cn) => s + Number(cn.cgst_amount) + Number(cn.sgst_amount) + Number(cn.igst_amount),
      0,
    );

    return {
      invoiceCount: invoices.length,
      taxableValue,
      cgst,
      sgst,
      igst,
      totalTax: cgst + sgst + igst,
      missingGstinCount,
      invalidGstinCount,
      b2b: b2b.sort((a, b) => b.cgst + b.sgst + b.igst - (a.cgst + a.sgst + a.igst)),
      b2c: [...b2c.values()].sort((a, b) => b.tax - a.tax),
      byHsn: [...byHsn.values()].sort((a, b) => b.tax - a.tax),
      creditNotes,
      creditTaxableValue,
      creditTax,
      netTaxableValue: taxableValue - creditTaxableValue,
      netTax: cgst + sgst + igst - creditTax,
    };
  }, [salesInvoices.data]);

  const exportOutwardRegister = () => {
    const rows: (string | number)[][] = [
      ["Sales register / GSTR-1 outward supply", org?.name ?? "", period],
      [],
      ["B2B invoices"],
      [
        "Invoice number",
        "Invoice date",
        "Customer",
        "Customer GSTIN",
        "Taxable value",
        "CGST",
        "SGST",
        "IGST",
        "Total tax",
      ],
      ...outwardSummary.b2b.map((r) => [
        r.invoiceNumber,
        r.invoiceDate,
        r.customerName,
        r.gstin,
        r.taxableValue,
        r.cgst,
        r.sgst,
        r.igst,
        r.cgst + r.sgst + r.igst,
      ]),
      [],
      ["B2C summary (by place of supply)"],
      ["State", "Taxable value", "Tax"],
      ...outwardSummary.b2c.map((r) => [r.state, r.taxableValue, r.tax]),
      [],
      ["HSN-wise summary"],
      ["HSN code", "Taxable value", "Tax"],
      ...outwardSummary.byHsn.map((h) => [h.hsn, h.taxableValue, h.tax]),
      [],
      ["Credit notes issued"],
      [
        "Credit note number",
        "Date",
        "Against invoice",
        "Taxable value",
        "CGST",
        "SGST",
        "IGST",
        "Total",
      ],
      ...outwardSummary.creditNotes.map((cn) => [
        cn.credit_note_number,
        cn.credit_note_date,
        cn.sales_invoices?.invoice_number ?? "",
        Number(cn.subtotal),
        Number(cn.cgst_amount),
        Number(cn.sgst_amount),
        Number(cn.igst_amount),
        Number(cn.subtotal) +
          Number(cn.cgst_amount) +
          Number(cn.sgst_amount) +
          Number(cn.igst_amount),
      ]),
    ];
    downloadCsv(`gstr1-outward-supply-${period}.csv`, rows);
  };

  const missingGstProfile = !org?.gstin && org?.gst_registration_type !== "unregistered";
  const isComposition = org?.gst_registration_type === "composition";

  return (
    <AppShell
      title="GST Filing"
      description="Purchase register (inward) and sales register (outward) for your monthly GST filing."
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="gst-period">Period</Label>
          <Input
            id="gst-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value || currentPeriod())}
            className="w-48"
          />
        </div>

        <Tabs defaultValue="inward">
          <TabsList>
            <TabsTrigger value="inward">Inward (Purchases)</TabsTrigger>
            <TabsTrigger value="outward">Outward (Sales)</TabsTrigger>
          </TabsList>

          <TabsContent value="inward" className="space-y-6">
            <p className="max-w-3xl rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              This covers the <span className="font-medium text-foreground">purchase side</span>{" "}
              (inward supplies) — the taxable value and ITC-eligible tax paid on your Purchase
              Orders, which is what you reconcile against GSTR-2B and enter into GSTR-3B.
            </p>

            {missingGstProfile ? (
              <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Your business has no GSTIN on file, so purchase orders can't reliably split
                  CGST/SGST vs. IGST. Set it under Account → GST profile first.
                </span>
              </div>
            ) : null}

            {isComposition ? (
              <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Your business is registered under the{" "}
                  <span className="font-medium">Composition Scheme</span> — composition dealers
                  can't claim input tax credit on purchases. The tax below is a real cost to you,
                  not a reclaimable credit; this register is for your own records, not for an ITC
                  claim.
                </span>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                onClick={exportRegister}
                disabled={!purchases.data || purchases.data.length === 0}
              >
                <Download className="size-4" />
                Export purchase register (CSV)
              </Button>
            </div>

            {purchases.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard label="Taxable value" value={inr.format(summary.taxableValue)} />
                  <SummaryCard label="CGST" value={inr.format(summary.cgst)} />
                  <SummaryCard label="SGST" value={inr.format(summary.sgst)} />
                  <SummaryCard label="IGST" value={inr.format(summary.igst)} />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Supplier-wise ITC summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {summary.bySupplier.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No purchase orders in this period yet.
                      </p>
                    ) : (
                      <>
                        <div className="hidden overflow-x-auto sm:block">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Supplier</TableHead>
                                <TableHead>GSTIN</TableHead>
                                <TableHead className="text-right">Taxable value</TableHead>
                                <TableHead className="text-right">Tax</TableHead>
                                <TableHead>GSTIN status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {summary.bySupplier.map((s) => (
                                <TableRow key={s.name + s.gstin}>
                                  <TableCell className="font-medium">{s.name}</TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {s.gstin ?? "—"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {inr.format(s.taxableValue)}
                                  </TableCell>
                                  <TableCell className="text-right">{inr.format(s.tax)}</TableCell>
                                  <TableCell>
                                    {s.risk === "missing" ? (
                                      <Badge variant="destructive">
                                        <FileWarning className="size-3" />
                                        No GSTIN — reverse charge?
                                      </Badge>
                                    ) : s.risk === "invalid" ? (
                                      <Badge variant="destructive">
                                        <FileWarning className="size-3" />
                                        Invalid GSTIN
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline">OK</Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="space-y-3 sm:hidden">
                          {summary.bySupplier.map((s) => (
                            <div
                              key={s.name + s.gstin}
                              className="rounded-lg border border-border p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{s.name}</p>
                                  <p className="truncate font-mono text-xs text-muted-foreground">
                                    {s.gstin ?? "—"}
                                  </p>
                                </div>
                                {s.risk === "missing" ? (
                                  <Badge variant="destructive" className="shrink-0">
                                    <FileWarning className="size-3" />
                                    No GSTIN
                                  </Badge>
                                ) : s.risk === "invalid" ? (
                                  <Badge variant="destructive" className="shrink-0">
                                    <FileWarning className="size-3" />
                                    Invalid
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="shrink-0">
                                    OK
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-x-3 text-sm">
                                <div>
                                  <p className="text-xs text-muted-foreground">Taxable value</p>
                                  <p>{inr.format(s.taxableValue)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Tax</p>
                                  <p>{inr.format(s.tax)}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">HSN-wise summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {summary.byHsn.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nothing to summarize yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>HSN code</TableHead>
                              <TableHead className="text-right">Taxable value</TableHead>
                              <TableHead className="text-right">Tax</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {summary.byHsn.map((h) => (
                              <TableRow key={h.hsn}>
                                <TableCell className="font-mono text-xs">{h.hsn}</TableCell>
                                <TableCell className="text-right">
                                  {inr.format(h.taxableValue)}
                                </TableCell>
                                <TableCell className="text-right">{inr.format(h.tax)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="outward" className="space-y-6">
            <p className="max-w-3xl rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              This covers the <span className="font-medium text-foreground">sales side</span>{" "}
              (outward supplies) — sales invoices grouped by customer and HSN, split B2B/B2C, ready
              for GSTR-1.
            </p>

            {outwardSummary.missingGstinCount > 0 || outwardSummary.invalidGstinCount > 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {outwardSummary.missingGstinCount > 0
                    ? `${outwardSummary.missingGstinCount} invoice${outwardSummary.missingGstinCount === 1 ? "" : "s"} this period ${outwardSummary.missingGstinCount === 1 ? "has" : "have"} a customer with no GSTIN on file`
                    : null}
                  {outwardSummary.missingGstinCount > 0 && outwardSummary.invalidGstinCount > 0
                    ? "; "
                    : null}
                  {outwardSummary.invalidGstinCount > 0
                    ? `${outwardSummary.invalidGstinCount} invoice${outwardSummary.invalidGstinCount === 1 ? "" : "s"} ${outwardSummary.invalidGstinCount === 1 ? "has" : "have"} an invalid customer GSTIN`
                    : null}{" "}
                  — treated as B2C below.
                </span>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={exportOutwardRegister} disabled={outwardSummary.invoiceCount === 0}>
                <Download className="size-4" />
                Export GSTR-1 outward supply (CSV)
              </Button>
            </div>

            {salesInvoices.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard
                    label="Taxable value"
                    value={inr.format(outwardSummary.taxableValue)}
                  />
                  <SummaryCard label="CGST" value={inr.format(outwardSummary.cgst)} />
                  <SummaryCard label="SGST" value={inr.format(outwardSummary.sgst)} />
                  <SummaryCard label="IGST" value={inr.format(outwardSummary.igst)} />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">B2B invoices</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {outwardSummary.b2b.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No B2B (GSTIN-registered customer) invoices this period.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Invoice</TableHead>
                              <TableHead>Customer</TableHead>
                              <TableHead>GSTIN</TableHead>
                              <TableHead className="text-right">Taxable value</TableHead>
                              <TableHead className="text-right">Tax</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {outwardSummary.b2b.map((r) => (
                              <TableRow key={r.invoiceNumber}>
                                <TableCell className="font-mono text-xs">
                                  {r.invoiceNumber}
                                  <div className="text-muted-foreground">
                                    {formatDate(r.invoiceDate)}
                                  </div>
                                </TableCell>
                                <TableCell className="font-medium">{r.customerName}</TableCell>
                                <TableCell className="font-mono text-xs">{r.gstin}</TableCell>
                                <TableCell className="text-right">
                                  {inr.format(r.taxableValue)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {inr.format(r.cgst + r.sgst + r.igst)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">B2C summary (by place of supply)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {outwardSummary.b2c.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No B2C (unregistered customer) invoices this period.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>State</TableHead>
                              <TableHead className="text-right">Taxable value</TableHead>
                              <TableHead className="text-right">Tax</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {outwardSummary.b2c.map((r) => (
                              <TableRow key={r.state}>
                                <TableCell className="font-medium">{r.state}</TableCell>
                                <TableCell className="text-right">
                                  {inr.format(r.taxableValue)}
                                </TableCell>
                                <TableCell className="text-right">{inr.format(r.tax)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">HSN-wise summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {outwardSummary.byHsn.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nothing to summarize yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>HSN code</TableHead>
                              <TableHead className="text-right">Taxable value</TableHead>
                              <TableHead className="text-right">Tax</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {outwardSummary.byHsn.map((h) => (
                              <TableRow key={h.hsn}>
                                <TableCell className="font-mono text-xs">{h.hsn}</TableCell>
                                <TableCell className="text-right">
                                  {inr.format(h.taxableValue)}
                                </TableCell>
                                <TableCell className="text-right">{inr.format(h.tax)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {outwardSummary.creditNotes.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Credit notes issued</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Credit note</TableHead>
                              <TableHead>Against invoice</TableHead>
                              <TableHead className="text-right">Taxable value</TableHead>
                              <TableHead className="text-right">Tax</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {outwardSummary.creditNotes.map((cn) => (
                              <TableRow key={cn.id}>
                                <TableCell className="font-mono text-xs">
                                  {cn.credit_note_number}
                                  <div className="text-muted-foreground">
                                    {formatDate(cn.credit_note_date)}
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {cn.sales_invoices?.invoice_number ?? "—"}
                                </TableCell>
                                <TableCell className="text-right">
                                  {inr.format(Number(cn.subtotal))}
                                </TableCell>
                                <TableCell className="text-right">
                                  {inr.format(
                                    Number(cn.cgst_amount) +
                                      Number(cn.sgst_amount) +
                                      Number(cn.igst_amount),
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm font-medium">
                        <span>Net outward taxable value / tax after credit notes</span>
                        <span>
                          {inr.format(outwardSummary.netTaxableValue)} /{" "}
                          {inr.format(outwardSummary.netTax)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <Receipt className="size-4 text-signal" />
        </div>
        <p className="mt-2 font-display text-2xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
