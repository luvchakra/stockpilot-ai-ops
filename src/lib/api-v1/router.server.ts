// Entry point for every /api/v1/* request. Wired directly into
// src/server.ts (see its comment for why): this app's installed
// TanStack Start version has no file-based "API route" primitive, only
// server functions (an RPC wire format for the SPA, not a stable public
// HTTP surface for third-party integrations) and React Server
// Components -- so /api/v1 is handled as its own small Fetch API
// (Request -> Response) dispatcher, intercepted ahead of the app router
// entirely, rather than fought into either of those.
import type { ApiKeyContext } from "./auth.server";
import { resolveApiKey } from "./auth.server";
import { ApiError, errorResponse, jsonResponse } from "./response";
import { openApiSpec } from "./openapi";
import { handle as products } from "./resources/products.server";
import { handle as warehouses } from "./resources/warehouses.server";
import { handle as inventory } from "./resources/inventory.server";
import { handle as purchaseOrders } from "./resources/purchase-orders.server";
import { handle as salesOrders } from "./resources/sales-orders.server";
import { handle as customers } from "./resources/customers.server";
import { handle as suppliers } from "./resources/suppliers.server";
import { handle as salesInvoices } from "./resources/sales-invoices.server";

type ResourceHandler = (
  request: Request,
  ctx: ApiKeyContext,
  id: string | undefined,
  query: URLSearchParams,
) => Promise<Response>;

const RESOURCES: Record<string, ResourceHandler> = {
  products,
  warehouses,
  inventory,
  "purchase-orders": purchaseOrders,
  "sales-orders": salesOrders,
  customers,
  suppliers,
  "sales-invoices": salesInvoices,
};

const API_PREFIX = "/api/v1/";

/** Returns null for any path outside /api/v1/, so the caller can fall through to the normal app router. */
export async function handleApiV1Request(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(API_PREFIX)) return null;

  const rest = url.pathname.slice(API_PREFIX.length);

  if (rest === "openapi.json" && request.method === "GET") {
    return jsonResponse(openApiSpec);
  }

  try {
    const [resource, id, extra] = rest.split("/").filter(Boolean);
    if (extra) {
      throw new ApiError(404, "not_found", "Nested resource paths are not supported.");
    }

    const handler = resource ? RESOURCES[resource] : undefined;
    if (!handler) {
      throw new ApiError(
        404,
        "not_found",
        resource
          ? `Unknown resource '${resource}'. See GET /api/v1/openapi.json for the full list.`
          : "Specify a resource, e.g. /api/v1/products.",
      );
    }

    const ctx = await resolveApiKey(request);
    return await handler(request, ctx, id, url.searchParams);
  } catch (err) {
    return errorResponse(err);
  }
}
