// Hand-written for the same reasons as purchase-orders.server.ts:
// nested line items, a generated so_number, and v1 being create-only
// (no PATCH -- workflow actions like confirm/ship are a fast-follow).
//
// so_number reproduces next_sales_order_number()'s per-financial-year
// counter logic directly against sales_order_counters rather than
// calling that RPC: the RPC's own is_org_member() guard resolves
// auth.uid() from the caller's session, which is null under the
// service-role client this whole API layer runs as -- it would reject
// every call. Duplicating just the counter arithmetic (not the
// permission check, which requirePermission below already covers) sidesteps
// that without weakening anything.
import type { ApiKeyContext } from "../auth.server";
import { requirePermission } from "../auth.server";
import { ApiError, jsonResponse, parseJsonBody } from "../response";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any;

const LIST_SELECT =
  "id, so_number, status, order_date, expected_fulfillment_date, customer_id, customers(name), warehouse_id, warehouses(name), subtotal, discount_amount, cgst_amount, sgst_amount, igst_amount, shipping_amount, total_amount, notes, created_at, updated_at";
const SINGLE_SELECT = `${LIST_SELECT}, sales_order_items(id, product_id, quantity, unit_price, tax_rate, cgst_amount, sgst_amount, igst_amount, products(sku, name))`;

interface ItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
}

async function nextSalesOrderNumber(db: AdminDb, orgId: string): Promise<string> {
  const today = new Date();
  const fy =
    today.getUTCMonth() + 1 >= 4
      ? `${String(today.getUTCFullYear()).slice(-2)}-${String(today.getUTCFullYear() + 1).slice(-2)}`
      : `${String(today.getUTCFullYear() - 1).slice(-2)}-${String(today.getUTCFullYear()).slice(-2)}`;

  const { data: existing } = await db
    .from("sales_order_counters")
    .select("next_number")
    .eq("org_id", orgId)
    .eq("financial_year", fy)
    .maybeSingle();

  const n = existing?.next_number ?? 1;
  const { error } = await db
    .from("sales_order_counters")
    .upsert(
      { org_id: orgId, financial_year: fy, next_number: n + 1 },
      { onConflict: "org_id,financial_year" },
    );
  if (error) throw new ApiError(500, "internal_error", "Could not mint a sales order number.");

  return `SO/${fy}/${String(n).padStart(4, "0")}`;
}

function parseItems(body: Record<string, unknown>): ItemInput[] {
  const raw = body["items"];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, "invalid_request", "'items' must be an array.");
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new ApiError(400, "invalid_request", `items[${i}] must be an object.`);
    }
    const r = item as Record<string, unknown>;
    if (typeof r["product_id"] !== "string" || typeof r["quantity"] !== "number") {
      throw new ApiError(
        400,
        "invalid_request",
        `items[${i}] requires a string product_id and numeric quantity.`,
      );
    }
    return {
      product_id: r["product_id"],
      quantity: r["quantity"],
      unit_price: typeof r["unit_price"] === "number" ? r["unit_price"] : 0,
      tax_rate: typeof r["tax_rate"] === "number" ? r["tax_rate"] : 0,
      cgst_amount: typeof r["cgst_amount"] === "number" ? r["cgst_amount"] : 0,
      sgst_amount: typeof r["sgst_amount"] === "number" ? r["sgst_amount"] : 0,
      igst_amount: typeof r["igst_amount"] === "number" ? r["igst_amount"] : 0,
    };
  });
}

export async function handle(
  request: Request,
  ctx: ApiKeyContext,
  id: string | undefined,
  query: URLSearchParams,
): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as AdminDb;

  if (request.method === "GET" && !id) {
    const limit = Math.min(Math.max(Number(query.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(query.get("offset")) || 0, 0);
    const { data, error, count } = await db
      .from("sales_orders")
      .select(LIST_SELECT, { count: "exact" })
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new ApiError(500, "internal_error", error.message);
    return jsonResponse({ data, meta: { limit, offset, count: count ?? data?.length ?? 0 } });
  }

  if (request.method === "GET" && id) {
    const { data, error } = await db
      .from("sales_orders")
      .select(SINGLE_SELECT)
      .eq("org_id", ctx.orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", error.message);
    if (!data) throw new ApiError(404, "not_found", "No sales order found with that id.");
    return jsonResponse({ data });
  }

  if (request.method === "POST" && !id) {
    requirePermission(ctx, "sales_orders.edit");
    const body = await parseJsonBody(request);
    if (typeof body["customer_id"] !== "string" || typeof body["warehouse_id"] !== "string") {
      throw new ApiError(400, "invalid_request", "'customer_id' and 'warehouse_id' are required.");
    }
    const items = parseItems(body);
    const soNumber = await nextSalesOrderNumber(db, ctx.orgId);

    const { data: so, error } = await db
      .from("sales_orders")
      .insert({
        org_id: ctx.orgId,
        customer_id: body["customer_id"],
        warehouse_id: body["warehouse_id"],
        so_number: soNumber,
        order_date: typeof body["order_date"] === "string" ? body["order_date"] : undefined,
        expected_fulfillment_date:
          typeof body["expected_fulfillment_date"] === "string"
            ? body["expected_fulfillment_date"]
            : null,
        notes: typeof body["notes"] === "string" ? body["notes"] : null,
        subtotal: typeof body["subtotal"] === "number" ? body["subtotal"] : 0,
        discount_amount: typeof body["discount_amount"] === "number" ? body["discount_amount"] : 0,
        shipping_amount: typeof body["shipping_amount"] === "number" ? body["shipping_amount"] : 0,
        cgst_amount: typeof body["cgst_amount"] === "number" ? body["cgst_amount"] : 0,
        sgst_amount: typeof body["sgst_amount"] === "number" ? body["sgst_amount"] : 0,
        igst_amount: typeof body["igst_amount"] === "number" ? body["igst_amount"] : 0,
        total_amount: typeof body["total_amount"] === "number" ? body["total_amount"] : 0,
        created_by: ctx.createdBy,
      })
      .select(SINGLE_SELECT)
      .single();
    if (error) throw new ApiError(400, "invalid_request", error.message);

    if (items.length > 0) {
      const { error: itemsError } = await db.from("sales_order_items").insert(
        items.map((item) => ({
          org_id: ctx.orgId,
          sales_order_id: so.id,
          ...item,
        })),
      );
      if (itemsError) throw new ApiError(400, "invalid_request", itemsError.message);
    }

    const { data: created } = await db
      .from("sales_orders")
      .select(SINGLE_SELECT)
      .eq("id", so.id)
      .single();
    return jsonResponse({ data: created ?? so }, 201);
  }

  throw new ApiError(405, "method_not_allowed", `${request.method} is not supported here.`);
}
