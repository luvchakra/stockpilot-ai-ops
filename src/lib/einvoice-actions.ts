// Server functions for generating/cancelling e-Invoices (IRN + QR) (SP-8).
//
// GSP credentials are a real secret, same class of risk flagged in SP-2's
// reveal-service-role-key finding and reused verbatim from the SP-7
// e-Way Bill design: they must never reach the browser. The admin client
// that can read them is loaded with a dynamic import inside each handler
// rather than a top-level import, matching this codebase's established
// convention (see client.server.ts) for keeping secret-capable clients
// out of any bundle a route file might end up in.
//
// requireSupabaseAuth gives a `supabase` client scoped to the CALLER's own
// JWT, so every read of the invoice and the eventual einvoices insert/
// update still goes through ordinary RLS -- this code does not
// re-implement authorization, it relies on the database to enforce it
// exactly like the rest of the app.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { resolveStateCode } from "@/lib/gst";
import {
  EinvoiceError,
  buildEinvoicePayload,
  extractAuthToken,
  isWithinCancelWindow,
  parseGenerateResponse,
} from "@/lib/einvoice";

async function authenticateGsp(credentials: {
  auth_url: string;
  gsp_username: string | null;
  gsp_password: string | null;
  client_id: string | null;
  client_secret: string | null;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(credentials.auth_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(credentials.gsp_username ? { username: credentials.gsp_username } : {}),
        ...(credentials.gsp_password ? { password: credentials.gsp_password } : {}),
        ...(credentials.client_id ? { client_id: credentials.client_id } : {}),
        ...(credentials.client_secret ? { client_secret: credentials.client_secret } : {}),
      }),
    });
  } catch (err) {
    throw new EinvoiceError(
      "provider_unreachable",
      "Could not reach the e-Invoicing provider's authentication endpoint.",
      err instanceof Error ? err.message : err,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new EinvoiceError(
      "authentication_failed",
      `The e-Invoicing provider rejected the authentication request (HTTP ${res.status}).`,
      body,
    );
  }
  return extractAuthToken(body);
}

// --- Generate ---------------------------------------------------------

const generateInputSchema = z.object({
  orgId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  buyerPincode: z.string().optional(),
  buyerPlace: z.string().optional(),
});

export const generateEinvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => generateInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("name, gstin, state")
      .eq("id", data.orgId)
      .single();
    if (orgError || !org) throw new EinvoiceError("not_found", "Organization not found.");

    const { data: invoice, error: invError } = await supabase
      .from("sales_invoices")
      .select(
        "invoice_number, invoice_date, subtotal, discount_amount, cgst_amount, sgst_amount, igst_amount, customer_id, customer_gstin, billing_address, sales_order_id",
      )
      .eq("id", data.invoiceId)
      .single();
    if (invError || !invoice) throw new EinvoiceError("not_found", "Sales invoice not found.");

    const [{ data: customer }, { data: salesOrder }, { data: items }] = await Promise.all([
      supabase.from("customers").select("name, state").eq("id", invoice.customer_id).single(),
      supabase
        .from("sales_orders")
        .select("warehouse_id")
        .eq("id", invoice.sales_order_id)
        .single(),
      supabase
        .from("sales_invoice_items")
        .select(
          "quantity, unit_price, tax_rate, cgst_amount, sgst_amount, igst_amount, hsn_code, products(name, unit)",
        )
        .eq("invoice_id", data.invoiceId),
    ]);
    if (!customer || !salesOrder)
      throw new EinvoiceError("not_found", "Customer or sales order not found.");

    const { data: warehouse } = await supabase
      .from("warehouses")
      .select("address, city, state, postal_code")
      .eq("id", salesOrder.warehouse_id)
      .single();
    if (!warehouse) throw new EinvoiceError("not_found", "Warehouse not found.");

    const payload = buildEinvoicePayload({
      docNo: invoice.invoice_number,
      docDate: invoice.invoice_date,
      seller: {
        gstin: org.gstin,
        legalName: org.name,
        address: warehouse.address,
        place: warehouse.city,
        pincode: warehouse.postal_code,
        stateCode: resolveStateCode(warehouse.state ?? org.state, org.gstin),
      },
      buyer: {
        gstin: invoice.customer_gstin,
        legalName: customer.name,
        address: invoice.billing_address,
        place: data.buyerPlace ?? null,
        pincode: data.buyerPincode ?? null,
        stateCode: resolveStateCode(customer.state, invoice.customer_gstin),
      },
      items: (items ?? []).map(
        (it: {
          quantity: number;
          unit_price: number;
          tax_rate: number;
          cgst_amount: number;
          sgst_amount: number;
          igst_amount: number;
          hsn_code: string | null;
          products: { name: string; unit: string } | null;
        }) => {
          const igstRate = it.igst_amount > 0 ? it.tax_rate : 0;
          const cgstRate = it.igst_amount > 0 ? 0 : it.tax_rate / 2;
          const sgstRate = it.igst_amount > 0 ? 0 : it.tax_rate / 2;
          return {
            productName: it.products?.name ?? "Item",
            hsnCode: it.hsn_code,
            quantity: it.quantity,
            unit: it.products?.unit ?? "pcs",
            unitPrice: it.unit_price,
            taxableAmount: it.quantity * it.unit_price,
            cgstRate,
            sgstRate,
            igstRate,
            cgstAmount: it.cgst_amount,
            sgstAmount: it.sgst_amount,
            igstAmount: it.igst_amount,
          };
        },
      ),
      totalValue: Number(invoice.subtotal),
      cgstValue: Number(invoice.cgst_amount),
      sgstValue: Number(invoice.sgst_amount),
      igstValue: Number(invoice.igst_amount),
      discountValue: Number(invoice.discount_amount),
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credentials } = await supabaseAdmin
      .from("einvoice_credentials")
      .select("auth_url, generate_url, gsp_username, gsp_password, client_id, client_secret")
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (!credentials) {
      throw new EinvoiceError(
        "credentials_not_configured",
        "e-Invoicing credentials are not configured for this organization. Add them under Organization Settings.",
      );
    }

    const token = await authenticateGsp(credentials);

    let res: Response;
    try {
      res = await fetch(credentials.generate_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authtoken: token,
          gstin: org.gstin ?? "",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new EinvoiceError(
        "provider_unreachable",
        "Could not reach the e-Invoicing provider's generate endpoint.",
        err instanceof Error ? err.message : err,
      );
    }
    const responseBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new EinvoiceError(
        "invalid_request",
        `The e-Invoicing provider rejected the request (HTTP ${res.status}). Check the GSTIN, HSN codes, and buyer details.`,
        responseBody,
      );
    }
    const result = parseGenerateResponse(responseBody);

    const { data: row, error: insertError } = await supabase
      .from("einvoices")
      .insert({
        org_id: data.orgId,
        invoice_id: data.invoiceId,
        irn: result.irn,
        ack_no: result.ackNo,
        ack_date: result.ackDate,
        qr_code: result.qrCode,
        request_payload: payload as unknown as Json,
        response_payload: result.raw as unknown as Json,
      })
      .select("id, irn, ack_no, ack_date, qr_code, status")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        throw new EinvoiceError(
          "invalid_request",
          "This invoice already has an active e-Invoice (IRN). Cancel it before generating a new one.",
        );
      }
      throw new EinvoiceError(
        "forbidden",
        "The e-Invoice was generated with the provider, but could not be recorded — you may not have permission to record e-Invoices for this organization. Contact your administrator; the IRN is real and was generated.",
        insertError,
      );
    }

    return row;
  });

// --- Cancel -------------------------------------------------------------

const cancelInputSchema = z.object({
  orgId: z.string().uuid(),
  einvoiceId: z.string().uuid(),
  reason: z.string().optional(),
});

export const cancelEinvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cancelInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: einvoice, error } = await supabase
      .from("einvoices")
      .select("irn, ack_date, status")
      .eq("id", data.einvoiceId)
      .eq("org_id", data.orgId)
      .single();
    if (error || !einvoice) throw new EinvoiceError("not_found", "e-Invoice not found.");
    if (einvoice.status !== "generated") {
      throw new EinvoiceError("invalid_request", "This e-Invoice is not currently active.");
    }
    if (!isWithinCancelWindow(einvoice.ack_date)) {
      throw new EinvoiceError(
        "cancel_window_expired",
        "This e-Invoice was generated more than 24 hours ago and can no longer be cancelled through the IRP.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credentials } = await supabaseAdmin
      .from("einvoice_credentials")
      .select("auth_url, cancel_url, gsp_username, gsp_password, client_id, client_secret")
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (!credentials) {
      throw new EinvoiceError(
        "credentials_not_configured",
        "e-Invoicing credentials are not configured for this organization.",
      );
    }

    const token = await authenticateGsp(credentials);

    let res: Response;
    try {
      res = await fetch(credentials.cancel_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", authtoken: token },
        body: JSON.stringify({
          Irn: einvoice.irn,
          // IRP cancel reason codes: 1 Duplicate, 2 Data Entry Mistake,
          // 3 Order Cancelled, 4 Others -- verify against your GSP's
          // exact list before relying on this in production.
          CnlRsn: "4",
          CnlRem: data.reason || "Cancelled via StockPilot",
        }),
      });
    } catch (err) {
      throw new EinvoiceError(
        "provider_unreachable",
        "Could not reach the e-Invoicing provider's cancel endpoint.",
        err instanceof Error ? err.message : err,
      );
    }
    const responseBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new EinvoiceError(
        "invalid_request",
        `The e-Invoicing provider rejected the cancellation (HTTP ${res.status}).`,
        responseBody,
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("einvoices")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: data.reason ?? null,
      })
      .eq("id", data.einvoiceId)
      .select("id, status, cancelled_at")
      .single();
    if (updateError || !updated) {
      throw new EinvoiceError(
        "forbidden",
        "The e-Invoice was cancelled with the provider, but the local record could not be updated.",
        updateError,
      );
    }
    return updated;
  });
