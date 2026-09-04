// Generic org-scoped CRUD handler factory for the simpler public API v1
// resources (products, warehouses, customers, suppliers, inventory,
// sales invoices). Purchase orders and sales orders are hand-written
// (resources/purchase-orders.server.ts, resources/sales-orders.server.ts)
// since creating one also means creating its line items, which a
// single-table factory can't express.
import type { ApiKeyContext } from "./auth.server";
import { requirePermission } from "./auth.server";
import { ApiError, jsonResponse, parseJsonBody, pick } from "./response";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any;

export interface CrudConfig {
  table: string;
  listSelect: string;
  singleSelect?: string;
  defaultOrder?: { column: string; ascending?: boolean };
  /** Omit to make the resource read-only (e.g. inventory, sales invoices). */
  writePermission?: string;
  insertFields?: readonly string[];
  updateFields?: readonly string[];
  /**
   * Columns that a permission-gated RLS-backed view would otherwise mask
   * (e.g. products_safe hiding cost_price behind inventory.view_cost).
   * That masking runs has_permission(), which resolves auth.uid() from
   * the caller's session -- there isn't one under service_role, so it
   * would always evaluate false and hide the field from every API key
   * regardless of its own snapshot. Reproduced here against the key's
   * actual permissions instead of relying on the view.
   */
  maskFields?: { column: string; permission: string }[];
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function applyMasking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  ctx: ApiKeyContext,
  maskFields: CrudConfig["maskFields"],
) {
  if (!row || !maskFields) return row;
  for (const { column, permission } of maskFields) {
    if (!ctx.permissions.includes(permission)) row[column] = null;
  }
  return row;
}

export function createCrudHandler(config: CrudConfig) {
  return async function handle(
    request: Request,
    ctx: ApiKeyContext,
    id: string | undefined,
    query: URLSearchParams,
  ): Promise<Response> {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as AdminDb;

    if (request.method === "GET" && !id) {
      const limit = Math.min(Math.max(Number(query.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const offset = Math.max(Number(query.get("offset")) || 0, 0);
      let q = db
        .from(config.table)
        .select(config.listSelect, { count: "exact" })
        .eq("org_id", ctx.orgId);
      if (config.defaultOrder) {
        q = q.order(config.defaultOrder.column, {
          ascending: config.defaultOrder.ascending ?? false,
        });
      }
      const { data, error, count } = await q.range(offset, offset + limit - 1);
      if (error) throw new ApiError(500, "internal_error", error.message);
      const rows = (data ?? []).map((row: unknown) => applyMasking(row, ctx, config.maskFields));
      return jsonResponse({ data: rows, meta: { limit, offset, count: count ?? rows.length } });
    }

    if (request.method === "GET" && id) {
      const { data, error } = await db
        .from(config.table)
        .select(config.singleSelect ?? config.listSelect)
        .eq("org_id", ctx.orgId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new ApiError(500, "internal_error", error.message);
      if (!data) throw new ApiError(404, "not_found", `No ${config.table} found with that id.`);
      return jsonResponse({ data: applyMasking(data, ctx, config.maskFields) });
    }

    if (request.method === "POST" && !id) {
      if (!config.writePermission || !config.insertFields) {
        throw new ApiError(405, "method_not_allowed", `${config.table} is read-only via the API.`);
      }
      requirePermission(ctx, config.writePermission);
      const body = await parseJsonBody(request);
      const payload = pick(body, config.insertFields);
      const { data, error } = await db
        .from(config.table)
        .insert({ ...payload, org_id: ctx.orgId })
        .select(config.singleSelect ?? config.listSelect)
        .single();
      if (error) throw new ApiError(400, "invalid_request", error.message);
      return jsonResponse({ data }, 201);
    }

    if (request.method === "PATCH" && id) {
      if (!config.writePermission || !config.updateFields) {
        throw new ApiError(
          405,
          "method_not_allowed",
          `${config.table} cannot be updated via the API.`,
        );
      }
      requirePermission(ctx, config.writePermission);
      const body = await parseJsonBody(request);
      const payload = pick(body, config.updateFields);
      const { data, error } = await db
        .from(config.table)
        .update(payload)
        .eq("org_id", ctx.orgId)
        .eq("id", id)
        .select(config.singleSelect ?? config.listSelect)
        .maybeSingle();
      if (error) throw new ApiError(400, "invalid_request", error.message);
      if (!data) throw new ApiError(404, "not_found", `No ${config.table} found with that id.`);
      return jsonResponse({ data });
    }

    throw new ApiError(
      405,
      "method_not_allowed",
      `${request.method} ${id ? "/{id}" : ""} is not supported on this resource.`,
    );
  };
}
