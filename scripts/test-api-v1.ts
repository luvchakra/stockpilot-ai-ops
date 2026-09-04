#!/usr/bin/env bun
// Integration tests for the public API v1 (SP-12).
//
// Calls handleApiV1Request() directly -- the exact function
// src/server.ts wires in ahead of the app router for every request --
// with constructed Fetch API Request objects, rather than starting a
// real HTTP server and making network calls to it. This exercises the
// real auth-resolution/permission-check/org-scoping code against the
// live Supabase project (same one scripts/test-tenant-rls.mjs targets)
// with none of the ceremony of booting the actual app server, and
// verifies the exact code this PR ships rather than whatever happens to
// already be deployed.
//
// Run with Bun (this repo's package manager; also resolves this file's
// `@/...` imports via tsconfig paths, which plain Node cannot):
//   SUPABASE_SERVICE_ROLE_KEY=... bun run scripts/test-api-v1.ts
//
// WHAT THIS CREATES: 2 throwaway organizations (created directly via
// SUPABASE_SERVICE_ROLE_KEY -- organizations.created_by has no foreign
// key, so a random placeholder id is fine and no throwaway auth users
// are needed at all, unlike test-tenant-rls.mjs's fixtures), api_keys/
// api_key_secrets rows, and a handful of products/purchase/sales
// orders. Deletes everything it created at the end (pass or fail).
//
// Does NOT test rate limiting (120 req/min/org) -- confirming the 429
// path would mean spending 120+ requests hammering the live project
// just to see one flip to 429, which isn't worth it here. Its atomic
// check-and-increment logic reuses the same INSERT ... ON CONFLICT DO
// UPDATE ... RETURNING pattern as the sales/credit-note counters, which
// scripts/test-tenant-rls.mjs already exercises for correctness under
// concurrent-ish sequential calls.

import { readFileSync } from "node:fs";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { handleApiV1Request } from "../src/lib/api-v1/router.server";

function loadDotEnv(path = ".env") {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      const key = m?.[1];
      const value = m?.[2];
      if (key && value !== undefined && !(key in process.env)) {
        process.env[key] = value.replace(/^"|"$/g, "");
      }
    }
  } catch {
    // no .env file — rely on process.env
  }
}
loadDotEnv();

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL (checked .env and process.env).");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.warn(
    "Skipping API v1 suite: SUPABASE_SERVICE_ROLE_KEY is not set (needed to create test " +
      "organizations/keys directly). Set that secret to run this suite.",
  );
  process.exit(0);
}

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const createdOrgIds: string[] = [];

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    if (detail) console.log(`    \x1b[2m${detail}\x1b[0m`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rest(method: string, table: string, opts: { body?: any; query?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SERVICE_KEY!,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Prefer: method === "GET" ? "" : "return=representation",
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${opts.query ?? ""}`, {
    method,
    headers,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data: data as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function makeOrg(tag: string) {
  const org = await rest("POST", "organizations", {
    body: {
      name: `API v1 Test Org ${tag} ${RUN_ID}`,
      slug: `apiv1-${tag}-${RUN_ID}`,
      created_by: randomUUID(),
    },
  });
  const orgId = org.data?.[0]?.id;
  if (!orgId) throw new Error(`Could not create test org ${tag}: ${JSON.stringify(org.data)}`);
  createdOrgIds.push(orgId);
  return orgId as string;
}

async function makeApiKey(orgId: string, permissions: string[]) {
  const rawKey = `sk_live_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const created = await rest("POST", "api_keys", {
    body: {
      org_id: orgId,
      name: `test key ${RUN_ID}`,
      key_prefix: rawKey.slice(0, 12),
      permissions,
      created_by: randomUUID(),
    },
  });
  const apiKeyId = created.data?.[0]?.id;
  if (!apiKeyId) throw new Error(`Could not create test API key: ${JSON.stringify(created.data)}`);
  const secret = await rest("POST", "api_key_secrets", {
    body: { api_key_id: apiKeyId, key_hash: keyHash },
  });
  if (!secret.ok)
    throw new Error(`Could not store test API key secret: ${JSON.stringify(secret.data)}`);
  return { id: apiKeyId as string, rawKey };
}

async function api(method: string, path: string, opts: { key?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.key) headers["authorization"] = `Bearer ${opts.key}`;
  const request = new Request(`https://stockpilot-api-v1-test.invalid/api/v1${path}`, {
    method,
    headers,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const res = await handleApiV1Request(request);
  if (!res) throw new Error(`handleApiV1Request returned null for ${method} ${path}`);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data: data as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function cleanup() {
  console.log("\nCleaning up test data...");
  for (const id of createdOrgIds) {
    await rest("DELETE", "organizations", { query: `?id=eq.${id}` });
  }
  console.log("Done.");
}

async function main() {
  console.log(`Testing public API v1 against ${SUPABASE_URL}\nRun id: ${RUN_ID}\n`);

  const orgAId = await makeOrg("a");
  const orgBId = await makeOrg("b");

  const ownerPerms = await rest("GET", "role_permissions", {
    query: "?role=eq.owner&select=permission_key",
  });
  const allPerms = (ownerPerms.data ?? []).map((r: { permission_key: string }) => r.permission_key);
  check(
    "fixture: resolved the owner role's real permission set",
    allPerms.length > 0,
    JSON.stringify(ownerPerms.data),
  );

  const fullKey = await makeApiKey(orgAId, allPerms);
  const limitedKey = await makeApiKey(orgAId, []);
  const revoked = await makeApiKey(orgAId, allPerms);
  await rest("PATCH", "api_keys", {
    query: `?id=eq.${revoked.id}`,
    body: { revoked_at: new Date().toISOString() },
  });
  const orgBKey = await makeApiKey(orgBId, allPerms);

  console.log("Authentication");
  {
    const noAuth = await api("GET", "/products");
    check(
      "no Authorization header is rejected (401)",
      noAuth.status === 401,
      `status ${noAuth.status}`,
    );

    const malformed = await api("GET", "/products", { key: "not-a-real-key" });
    check(
      "a malformed key is rejected (401)",
      malformed.status === 401,
      `status ${malformed.status}`,
    );

    const revokedAttempt = await api("GET", "/products", { key: revoked.rawKey });
    check(
      "a revoked key is rejected (401)",
      revokedAttempt.status === 401,
      `status ${revokedAttempt.status}, body ${JSON.stringify(revokedAttempt.data)}`,
    );

    const openapi = await api("GET", "/openapi.json");
    check(
      "GET /openapi.json needs no auth and returns a spec",
      openapi.status === 200 && typeof openapi.data?.openapi === "string",
      `status ${openapi.status}`,
    );

    const unknown = await api("GET", "/not-a-real-resource", { key: fullKey.rawKey });
    check("an unknown resource is a 404", unknown.status === 404, `status ${unknown.status}`);
  }

  console.log("\nProducts: permission-gated writes, unrestricted reads, cost masking");
  let productId: string | undefined;
  {
    const listEmpty = await api("GET", "/products", { key: fullKey.rawKey });
    check(
      "a fresh org's product list is empty",
      listEmpty.ok && Array.isArray(listEmpty.data?.data) && listEmpty.data.data.length === 0,
      `body ${JSON.stringify(listEmpty.data)}`,
    );

    const forbiddenCreate = await api("POST", "/products", {
      key: limitedKey.rawKey,
      body: { sku: `SKU-${RUN_ID}`, name: "Should not be created" },
    });
    check(
      "a key with no permissions cannot create a product (403)",
      forbiddenCreate.status === 403,
      `status ${forbiddenCreate.status}, body ${JSON.stringify(forbiddenCreate.data)}`,
    );

    const create = await api("POST", "/products", {
      key: fullKey.rawKey,
      body: {
        sku: `SKU-${RUN_ID}`,
        name: "API v1 Test Widget",
        selling_price: 199,
        cost_price: 120,
        unit: "pcs",
      },
    });
    check(
      "a fully-permissioned key can create a product (201)",
      create.status === 201 && !!create.data?.data?.id,
      `status ${create.status}, body ${JSON.stringify(create.data)}`,
    );
    productId = create.data?.data?.id;

    const readBack = await api("GET", `/products/${productId}`, { key: limitedKey.rawKey });
    check(
      "a permission-less key from the SAME org can still read it (reads are membership-only, like the UI)",
      readBack.ok && readBack.data?.data?.id === productId,
      `status ${readBack.status}, body ${JSON.stringify(readBack.data)}`,
    );
    check(
      "cost_price is masked for a key without inventory.view_cost",
      readBack.data?.data?.cost_price === null,
      `body ${JSON.stringify(readBack.data)}`,
    );

    const readBackFull = await api("GET", `/products/${productId}`, { key: fullKey.rawKey });
    check(
      "cost_price is visible for a key that has inventory.view_cost",
      readBackFull.data?.data?.cost_price === 120,
      `body ${JSON.stringify(readBackFull.data)}`,
    );
  }

  console.log("\nCross-tenant isolation");
  {
    const crossList = await api("GET", "/products", { key: orgBKey.rawKey });
    const leaked = (crossList.data?.data ?? []).some((p: { id: string }) => p.id === productId);
    check(
      "another org's key does not see this org's products in a list",
      crossList.ok && !leaked,
      `body ${JSON.stringify(crossList.data)}`,
    );

    const crossGet = await api("GET", `/products/${productId}`, { key: orgBKey.rawKey });
    check(
      "another org's key gets 404 fetching this org's product by id",
      crossGet.status === 404,
      `status ${crossGet.status}`,
    );

    const crossPatch = await api("PATCH", `/products/${productId}`, {
      key: orgBKey.rawKey,
      body: { name: "hijacked" },
    });
    check(
      "another org's key cannot update this org's product (404, not found in ITS org)",
      crossPatch.status === 404,
      `status ${crossPatch.status}`,
    );
  }

  console.log("\nPurchase orders and sales orders: nested line-item creation");
  {
    const supplier = await rest("POST", "suppliers", {
      body: { org_id: orgAId, name: "API Test Supplier" },
    });
    const warehouse = await rest("POST", "warehouses", {
      body: { org_id: orgAId, name: "API Test WH", code: `APIV1-${RUN_ID}` },
    });
    const customer = await rest("POST", "customers", {
      body: { org_id: orgAId, name: "API Test Customer" },
    });
    const supplierId = supplier.data?.[0]?.id;
    const warehouseId = warehouse.data?.[0]?.id;
    const customerId = customer.data?.[0]?.id;

    const po = await api("POST", "/purchase-orders", {
      key: fullKey.rawKey,
      body: {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        items: [{ product_id: productId, quantity: 5, unit_cost: 100 }],
      },
    });
    check(
      "a purchase order can be created with a nested line item",
      po.status === 201 && po.data?.data?.purchase_order_items?.length === 1,
      `status ${po.status}, body ${JSON.stringify(po.data)}`,
    );

    const forbiddenPo = await api("POST", "/purchase-orders", {
      key: limitedKey.rawKey,
      body: { supplier_id: supplierId, warehouse_id: warehouseId },
    });
    check(
      "a key without purchase_orders.edit cannot create a purchase order",
      forbiddenPo.status === 403,
      `status ${forbiddenPo.status}`,
    );

    const so = await api("POST", "/sales-orders", {
      key: fullKey.rawKey,
      body: {
        customer_id: customerId,
        warehouse_id: warehouseId,
        items: [{ product_id: productId, quantity: 2, unit_price: 199 }],
      },
    });
    check(
      "a sales order can be created with a nested line item",
      so.status === 201 && so.data?.data?.sales_order_items?.length === 1,
      `status ${so.status}, body ${JSON.stringify(so.data)}`,
    );
    check(
      "the sales order number follows the SO/FY/NNNN convention",
      /^SO\/\d{2}-\d{2}\/\d{4}$/.test(so.data?.data?.so_number ?? ""),
      `so_number ${so.data?.data?.so_number}`,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

main()
  .then(async (failed) => {
    await cleanup();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    await cleanup();
    console.error("\nSuite errored out:", err);
    process.exit(1);
  });
