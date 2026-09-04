// Hand-written rather than the generic CRUD factory: creating a
// purchase order also means creating its line items, and po_number
// needs generating -- both beyond what a single-table factory expresses.
//
// v1 is create-only (no PATCH): the workflow actions that mutate an
// existing PO (approve/send/receive) have real side effects (stock
// movements, audit rows) best exposed as their own endpoints once a
// real integration needs to drive them, not as a generic PATCH that
// could smuggle a status change past those rules. Same call for
// sales-orders.server.ts.
import type { ApiKeyContext } from "../auth.server";
import { requirePermission } from "../auth.server";
import { ApiError, jsonResponse, parseJsonBody } from "../response";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any;

const LIST_SELECT =
  "id, po_number, status, order_date, expected_delivery_date, supplier_id, suppliers(name), warehouse_id, warehouses(name), subtotal, discount_amount, tax_amount, cgst_amount, sgst_amount, igst_amount, shipping_amount, total_amount, notes, created_at, updated_at";
const SINGLE_SELECT = `${LIST_SELECT}, purchase_order_items(id, product_id, quantity, received_quantity, unit_cost, tax_rate, cgst_amount, sgst_amount, igst_amount, products(sku, name))`;

interface ItemInput {
  product_id: string;
  quantity: number;
  unit_cost: number;
  tax_rate?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
}

function newPoNumber(): string {
  return `PO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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
      unit_cost: typeof r["unit_cost"] === "number" ? r["unit_cost"] : 0,
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
      .from("purchase_orders")
      .select(LIST_SELECT, { count: "exact" })
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new ApiError(500, "internal_error", error.message);
    return jsonResponse({ data, meta: { limit, offset, count: count ?? data?.length ?? 0 } });
  }

  if (request.method === "GET" && id) {
    const { data, error } = await db
      .from("purchase_orders")
      .select(SINGLE_SELECT)
      .eq("org_id", ctx.orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", error.message);
    if (!data) throw new ApiError(404, "not_found", "No purchase order found with that id.");
    return jsonResponse({ data });
  }

  if (request.method === "POST" && !id) {
    requirePermission(ctx, "purchase_orders.edit");
    const body = await parseJsonBody(request);
    if (typeof body["supplier_id"] !== "string" || typeof body["warehouse_id"] !== "string") {
      throw new ApiError(400, "invalid_request", "'supplier_id' and 'warehouse_id' are required.");
    }
    const items = parseItems(body);

    const { data: po, error } = await db
      .from("purchase_orders")
      .insert({
        org_id: ctx.orgId,
        supplier_id: body["supplier_id"],
        warehouse_id: body["warehouse_id"],
        po_number: newPoNumber(),
        order_date: typeof body["order_date"] === "string" ? body["order_date"] : undefined,
        expected_delivery_date:
          typeof body["expected_delivery_date"] === "string"
            ? body["expected_delivery_date"]
            : null,
        notes: typeof body["notes"] === "string" ? body["notes"] : null,
        subtotal: typeof body["subtotal"] === "number" ? body["subtotal"] : 0,
        discount_amount: typeof body["discount_amount"] === "number" ? body["discount_amount"] : 0,
        shipping_amount: typeof body["shipping_amount"] === "number" ? body["shipping_amount"] : 0,
        tax_amount: typeof body["tax_amount"] === "number" ? body["tax_amount"] : 0,
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
      const { error: itemsError } = await db.from("purchase_order_items").insert(
        items.map((item) => ({
          org_id: ctx.orgId,
          purchase_order_id: po.id,
          ...item,
        })),
      );
      if (itemsError) throw new ApiError(400, "invalid_request", itemsError.message);
    }

    const { data: created } = await db
      .from("purchase_orders")
      .select(SINGLE_SELECT)
      .eq("id", po.id)
      .single();
    return jsonResponse({ data: created ?? po }, 201);
  }

  throw new ApiError(405, "method_not_allowed", `${request.method} is not supported here.`);
}
