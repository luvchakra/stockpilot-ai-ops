// Server functions for generating/cancelling e-Way Bills (SP-7).
//
// GSP credentials are a real secret, same class of risk flagged in SP-2's
// reveal-service-role-key finding: they must never reach the browser. The
// admin client that can read them is loaded with a dynamic import inside
// each handler rather than a top-level import, matching this codebase's
// established convention (see client.server.ts) for keeping secret-
// capable clients out of any bundle a route file might end up in.
//
// requireSupabaseAuth gives a `supabase` client scoped to the CALLER's own
// JWT, so every read of the source transaction and the eventual
// eway_bills insert/update still goes through ordinary RLS -- this code
// does not re-implement authorization, it relies on the database to
// enforce it exactly like the rest of the app.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { resolveStateCode } from "@/lib/gst";
import {
  EwayBillError,
  buildEwayBillPayload,
  extractAuthToken,
  isWithinCancelWindow,
  parseGenerateResponse,
  type EwayBillDocumentInfo,
  type EwayBillLineItem,
  type EwayBillPartyInfo,
} from "@/lib/eway-bill";

function deriveLineRates(taxRate: number, cgst: number, sgst: number, igst: number) {
  if (igst > 0) return { cgstRate: 0, sgstRate: 0, igstRate: taxRate };
  return { cgstRate: taxRate / 2, sgstRate: taxRate / 2, igstRate: 0 };
}

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
    throw new EwayBillError(
      "provider_unreachable",
      "Could not reach the e-Way Bill provider's authentication endpoint.",
      err instanceof Error ? err.message : err,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new EwayBillError(
      "authentication_failed",
      `The e-Way Bill provider rejected the authentication request (HTTP ${res.status}).`,
      body,
    );
  }
  return extractAuthToken(body);
}

// --- Generate ---------------------------------------------------------

const generateInputSchema = z.object({
  orgId: z.string().uuid(),
  sourceType: z.enum(["sales_order", "sales_invoice", "purchase_order"]),
  sourceId: z.string().uuid(),
  transportMode: z.enum(["road", "rail", "air", "ship"]),
  vehicleNumber: z.string().optional(),
  transporterId: z.string().optional(),
  transporterName: z.string().optional(),
  distanceKm: z.number().optional(),
  counterpartyPincode: z.string().optional(),
  counterpartyPlace: z.string().optional(),
});

type GenerateInput = z.infer<typeof generateInputSchema>;

async function loadSourceTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: GenerateInput,
  org: { name: string; gstin: string | null; state: string | null },
): Promise<{
  doc: Omit<
    EwayBillDocumentInfo,
    "transportMode" | "vehicleNumber" | "transporterId" | "transporterName" | "transDistanceKm"
  >;
}> {
  const orgParty = (warehouse: {
    address: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  }): EwayBillPartyInfo => ({
    gstin: org.gstin,
    legalName: org.name,
    address: warehouse.address,
    place: warehouse.city,
    pincode: warehouse.postal_code,
    stateCode: resolveStateCode(warehouse.state ?? org.state, org.gstin),
  });

  const counterparty = (info: {
    name: string;
    gstin: string | null;
    state: string | null;
    address: string | null;
  }): EwayBillPartyInfo => ({
    gstin: info.gstin,
    legalName: info.name,
    address: info.address,
    place: input.counterpartyPlace ?? null,
    pincode: input.counterpartyPincode ?? null,
    stateCode: resolveStateCode(info.state, info.gstin),
  });

  const toItems = (
    rows: {
      quantity: number;
      unit_price: number | null;
      unit_cost?: number | null;
      tax_rate: number;
      cgst_amount: number;
      sgst_amount: number;
      igst_amount: number;
      hsn_code: string | null;
      name: string;
      unit: string;
    }[],
  ): EwayBillLineItem[] =>
    rows.map((r) => {
      const rates = deriveLineRates(r.tax_rate, r.cgst_amount, r.sgst_amount, r.igst_amount);
      const price = r.unit_price ?? r.unit_cost ?? 0;
      return {
        productName: r.name,
        hsnCode: r.hsn_code,
        quantity: r.quantity,
        unit: r.unit,
        taxableAmount: r.quantity * price,
        ...rates,
      };
    });

  if (input.sourceType === "sales_order") {
    const { data: so, error } = await supabase
      .from("sales_orders")
      .select(
        "so_number, order_date, subtotal, cgst_amount, sgst_amount, igst_amount, customer_id, warehouse_id",
      )
      .eq("id", input.sourceId)
      .single();
    if (error || !so) throw new EwayBillError("not_found", "Sales order not found.");
    const [{ data: customer }, { data: warehouse }, { data: items }] = await Promise.all([
      supabase
        .from("customers")
        .select("name, gstin, state, billing_address")
        .eq("id", so.customer_id)
        .single(),
      supabase
        .from("warehouses")
        .select("address, city, state, postal_code")
        .eq("id", so.warehouse_id)
        .single(),
      supabase
        .from("sales_order_items")
        .select(
          "quantity, unit_price, tax_rate, cgst_amount, sgst_amount, igst_amount, products(name, hsn_code, unit)",
        )
        .eq("sales_order_id", input.sourceId),
    ]);
    if (!customer || !warehouse)
      throw new EwayBillError("not_found", "Customer or warehouse not found.");
    return {
      doc: {
        docType: "CHL",
        docNo: so.so_number,
        docDate: so.order_date,
        supplyType: "O",
        from: orgParty(warehouse),
        to: counterparty({
          name: customer.name,
          gstin: customer.gstin,
          state: customer.state,
          address: customer.billing_address,
        }),
        items: toItems(
          (items ?? []).map(
            (
              it: {
                products: { name: string; hsn_code: string | null; unit: string } | null;
              } & Record<string, unknown>,
            ) => ({
              ...it,
              name: it.products?.name ?? "Item",
              unit: it.products?.unit ?? "pcs",
              hsn_code: it.products?.hsn_code ?? null,
            }),
          ) as never,
        ),
        totalValue: Number(so.subtotal),
        cgstValue: Number(so.cgst_amount),
        sgstValue: Number(so.sgst_amount),
        igstValue: Number(so.igst_amount),
      },
    };
  }

  if (input.sourceType === "sales_invoice") {
    const { data: inv, error } = await supabase
      .from("sales_invoices")
      .select(
        "invoice_number, invoice_date, subtotal, cgst_amount, sgst_amount, igst_amount, customer_id, customer_gstin, billing_address, sales_order_id",
      )
      .eq("id", input.sourceId)
      .single();
    if (error || !inv) throw new EwayBillError("not_found", "Sales invoice not found.");
    const [{ data: customer }, { data: so }, { data: items }] = await Promise.all([
      supabase.from("customers").select("name, state").eq("id", inv.customer_id).single(),
      supabase.from("sales_orders").select("warehouse_id").eq("id", inv.sales_order_id).single(),
      supabase
        .from("sales_invoice_items")
        .select(
          "quantity, unit_price, tax_rate, cgst_amount, sgst_amount, igst_amount, hsn_code, products(name, unit)",
        )
        .eq("invoice_id", input.sourceId),
    ]);
    if (!customer || !so)
      throw new EwayBillError("not_found", "Customer or sales order not found.");
    const { data: warehouse } = await supabase
      .from("warehouses")
      .select("address, city, state, postal_code")
      .eq("id", so.warehouse_id)
      .single();
    if (!warehouse) throw new EwayBillError("not_found", "Warehouse not found.");
    return {
      doc: {
        docType: "INV",
        docNo: inv.invoice_number,
        docDate: inv.invoice_date,
        supplyType: "O",
        from: orgParty(warehouse),
        to: counterparty({
          name: customer.name,
          gstin: inv.customer_gstin,
          state: customer.state,
          address: inv.billing_address,
        }),
        items: toItems(
          (items ?? []).map(
            (
              it: { products: { name: string; unit: string } | null } & Record<string, unknown>,
            ) => ({
              ...it,
              name: it.products?.name ?? "Item",
              unit: it.products?.unit ?? "pcs",
            }),
          ) as never,
        ),
        totalValue: Number(inv.subtotal),
        cgstValue: Number(inv.cgst_amount),
        sgstValue: Number(inv.sgst_amount),
        igstValue: Number(inv.igst_amount),
      },
    };
  }

  // purchase_order: an inward movement -- the supplier dispatches, we receive.
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select(
      "po_number, order_date, subtotal, cgst_amount, sgst_amount, igst_amount, supplier_id, warehouse_id",
    )
    .eq("id", input.sourceId)
    .single();
  if (error || !po) throw new EwayBillError("not_found", "Purchase order not found.");
  const [{ data: supplier }, { data: warehouse }, { data: items }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("name, gst_number, state, address")
      .eq("id", po.supplier_id)
      .single(),
    supabase
      .from("warehouses")
      .select("address, city, state, postal_code")
      .eq("id", po.warehouse_id)
      .single(),
    supabase
      .from("purchase_order_items")
      .select(
        "quantity, unit_cost, tax_rate, cgst_amount, sgst_amount, igst_amount, products(name, hsn_code, unit)",
      )
      .eq("purchase_order_id", input.sourceId),
  ]);
  if (!supplier || !warehouse)
    throw new EwayBillError("not_found", "Supplier or warehouse not found.");
  return {
    doc: {
      docType: "OTH",
      docNo: po.po_number,
      docDate: po.order_date,
      supplyType: "I",
      from: counterparty({
        name: supplier.name,
        gstin: supplier.gst_number,
        state: supplier.state,
        address: supplier.address,
      }),
      to: orgParty(warehouse),
      items: toItems(
        (items ?? []).map(
          (
            it: {
              products: { name: string; hsn_code: string | null; unit: string } | null;
            } & Record<string, unknown>,
          ) => ({
            ...it,
            name: it.products?.name ?? "Item",
            unit: it.products?.unit ?? "pcs",
            hsn_code: it.products?.hsn_code ?? null,
          }),
        ) as never,
      ),
      totalValue: Number(po.subtotal),
      cgstValue: Number(po.cgst_amount),
      sgstValue: Number(po.sgst_amount),
      igstValue: Number(po.igst_amount),
    },
  };
}

export const generateEwayBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => generateInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("name, gstin, state")
      .eq("id", data.orgId)
      .single();
    if (orgError || !org) throw new EwayBillError("not_found", "Organization not found.");

    const { doc } = await loadSourceTransaction(supabase, data, org);

    const payload = buildEwayBillPayload({
      ...doc,
      transportMode: data.transportMode,
      ...(data.vehicleNumber ? { vehicleNumber: data.vehicleNumber } : {}),
      ...(data.transporterId ? { transporterId: data.transporterId } : {}),
      ...(data.transporterName ? { transporterName: data.transporterName } : {}),
      ...(data.distanceKm !== undefined ? { transDistanceKm: data.distanceKm } : {}),
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credentials } = await supabaseAdmin
      .from("eway_bill_credentials")
      .select("auth_url, generate_url, gsp_username, gsp_password, client_id, client_secret")
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (!credentials) {
      throw new EwayBillError(
        "credentials_not_configured",
        "e-Way Bill credentials are not configured for this organization. Add them under Organization Settings.",
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
      throw new EwayBillError(
        "provider_unreachable",
        "Could not reach the e-Way Bill provider's generate endpoint.",
        err instanceof Error ? err.message : err,
      );
    }
    const responseBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new EwayBillError(
        "invalid_request",
        `The e-Way Bill provider rejected the request (HTTP ${res.status}). Check the GSTIN, vehicle/transporter details, and item HSN codes.`,
        responseBody,
      );
    }
    const result = parseGenerateResponse(responseBody);

    const { data: row, error: insertError } = await supabase
      .from("eway_bills")
      .insert({
        org_id: data.orgId,
        source_type: data.sourceType,
        source_id: data.sourceId,
        ewb_number: result.ewbNumber,
        ewb_date: result.ewbDate,
        valid_until: result.validUntil,
        vehicle_number: data.vehicleNumber ?? null,
        transporter_id: data.transporterId ?? null,
        transporter_name: data.transporterName ?? null,
        transport_mode: data.transportMode,
        distance_km: data.distanceKm ?? null,
        request_payload: payload as unknown as Json,
        response_payload: result.raw as unknown as Json,
      })
      .select("id, ewb_number, ewb_date, valid_until, status")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        throw new EwayBillError(
          "invalid_request",
          "This transaction already has an active e-Way Bill. Cancel it before generating a new one.",
        );
      }
      throw new EwayBillError(
        "forbidden",
        "The e-Way Bill was generated with the provider, but could not be recorded — you may not have permission to record e-Way Bills for this organization. Contact your administrator; the bill is real and was generated.",
        insertError,
      );
    }

    return row;
  });

// --- Cancel -------------------------------------------------------------

const cancelInputSchema = z.object({
  orgId: z.string().uuid(),
  ewayBillId: z.string().uuid(),
  reason: z.string().optional(),
});

export const cancelEwayBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cancelInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: bill, error } = await supabase
      .from("eway_bills")
      .select("ewb_number, ewb_date, status")
      .eq("id", data.ewayBillId)
      .eq("org_id", data.orgId)
      .single();
    if (error || !bill) throw new EwayBillError("not_found", "e-Way Bill not found.");
    if (bill.status !== "generated") {
      throw new EwayBillError("invalid_request", "This e-Way Bill is not currently active.");
    }
    if (!isWithinCancelWindow(bill.ewb_date)) {
      throw new EwayBillError(
        "cancel_window_expired",
        "This e-Way Bill was generated more than 24 hours ago and can no longer be cancelled through the portal.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credentials } = await supabaseAdmin
      .from("eway_bill_credentials")
      .select("auth_url, cancel_url, gsp_username, gsp_password, client_id, client_secret")
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (!credentials) {
      throw new EwayBillError(
        "credentials_not_configured",
        "e-Way Bill credentials are not configured for this organization.",
      );
    }

    const token = await authenticateGsp(credentials);

    let res: Response;
    try {
      res = await fetch(credentials.cancel_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", authtoken: token },
        body: JSON.stringify({
          ewbNo: bill.ewb_number,
          // NIC cancel reason codes: 1 Duplicate, 2 Order Cancelled,
          // 3 Data Entry Mistake, 4 Others -- verify against your GSP's
          // exact list before relying on this in production.
          cancelRsnCode: "4",
          cancelRmrk: data.reason || "Cancelled via StockPilot",
        }),
      });
    } catch (err) {
      throw new EwayBillError(
        "provider_unreachable",
        "Could not reach the e-Way Bill provider's cancel endpoint.",
        err instanceof Error ? err.message : err,
      );
    }
    const responseBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new EwayBillError(
        "invalid_request",
        `The e-Way Bill provider rejected the cancellation (HTTP ${res.status}).`,
        responseBody,
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("eway_bills")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: data.reason ?? null,
      })
      .eq("id", data.ewayBillId)
      .select("id, status, cancelled_at")
      .single();
    if (updateError || !updated) {
      throw new EwayBillError(
        "forbidden",
        "The e-Way Bill was cancelled with the provider, but the local record could not be updated.",
        updateError,
      );
    }
    return updated;
  });
