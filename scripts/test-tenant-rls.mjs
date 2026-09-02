#!/usr/bin/env node
// Integration test suite for the multi-tenant RLS hardening
// (supabase/migrations/20260830130000_harden_tenant_rls.sql) plus RLS
// coverage for features added since: workspace editing, the
// purchase-order create/edit/receive workflow, and the reserved/damaged/
// expired inventory state model.
//
// Exercises the live Supabase project over its REST/Auth API — no
// @supabase/supabase-js needed, just Node's built-in fetch, so it runs
// with zero `npm install`.
//
// WHAT THIS CREATES: 4 throwaway auth users (emails tagged
// rls-test-<run>-*@test.stockpilot.invalid), 1 organization, and a
// handful of rows under it (products, a warehouse, a supplier, a
// purchase order and its line item, a stock movement).
//
// SUPABASE_SERVICE_ROLE_KEY is effectively required, not just for
// cleanup: if the project requires email confirmation before a session
// is issued (the default), the suite has no other way to authenticate
// its own test users and skips with a clear message instead of failing.
// With the key set, it creates pre-confirmed users via the Admin API
// and deletes everything it created at the end (pass or fail).
//
// This performs real writes against your live project. Do not run it
// against a database you care about without SUPABASE_SERVICE_ROLE_KEY
// set, or without being ready to hand-remove test rows/users yourself.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/test-tenant-rls.mjs

import { readFileSync } from "node:fs";

function loadDotEnv(path = ".env") {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // no .env file — rely on process.env
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // optional, enables cleanup

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (checked .env and process.env).");
  process.exit(1);
}

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const PASSWORD = `Test!${RUN_ID}Aa1`;
const createdUserIds = [];
let createdOrgId = null;

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    if (detail) console.log(`    \x1b[2m${detail}\x1b[0m`);
  }
}

async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function signUp(email, password) {
  return authRequest("/signup", { email, password });
}

async function signIn(email, password) {
  return authRequest("/token?grant_type=password", { email, password });
}

async function rpc(fn, { token, body } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: token ? ANON_KEY : (SERVICE_KEY ?? ANON_KEY),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (SERVICE_KEY) headers.Authorization = `Bearer ${SERVICE_KEY}`;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function rest(method, table, { token, body, query = "", extraHeaders = {} } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: token ? ANON_KEY : (SERVICE_KEY ?? ANON_KEY),
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (SERVICE_KEY) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  if (method !== "GET") headers.Prefer = "return=representation";

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

class NeedsServiceRoleKeyError extends Error {}

async function createConfirmedUserViaAdmin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`admin user creation failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.id ?? data.user?.id;
}

async function makeUser(tag) {
  const email = `rls-test-${RUN_ID}-${tag}@test.stockpilot.invalid`;

  if (SERVICE_KEY) {
    // Create the user pre-confirmed via the Admin API, so this suite works
    // regardless of the project's "confirm email" auth setting, then sign
    // in normally to get a real user-scoped access token for RLS checks.
    const userId = await createConfirmedUserViaAdmin(email, PASSWORD);
    const signin = await signIn(email, PASSWORD);
    if (!signin.ok || !signin.data.access_token) {
      throw new Error(
        `sign-in failed for admin-created user ${email}: ${JSON.stringify(signin.data)}`,
      );
    }
    createdUserIds.push({ email, id: userId });
    return { email, id: userId, token: signin.data.access_token };
  }

  const signup = await signUp(email, PASSWORD);
  if (!signup.ok) {
    throw new Error(`sign-up failed for ${email}: ${JSON.stringify(signup.data)}`);
  }
  const token = signup.data.access_token;
  const userId = signup.data.user?.id ?? signup.data.id;
  if (!token) {
    // Project requires email confirmation before a session is issued, and
    // we have no service-role key to create pre-confirmed users instead.
    throw new NeedsServiceRoleKeyError(
      `Project requires email confirmation before ${email} gets a session, and no ` +
        `SUPABASE_SERVICE_ROLE_KEY is set to create pre-confirmed test users instead. ` +
        `Set that secret to run this suite.`,
    );
  }
  createdUserIds.push({ email, id: userId });
  return { email, id: userId, token };
}

async function cleanup() {
  if (!SERVICE_KEY) {
    console.log(
      "\nSkipping cleanup (no SUPABASE_SERVICE_ROLE_KEY set). Test rows/users remain in the project:",
    );
    if (createdOrgId) console.log(`  organization: ${createdOrgId}`);
    for (const u of createdUserIds) console.log(`  auth user: ${u.email} (${u.id})`);
    return;
  }
  console.log("\nCleaning up test data...");
  if (createdOrgId) {
    await rest("DELETE", "organizations", { query: `?id=eq.${createdOrgId}` });
  }
  for (const u of createdUserIds) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  }
  console.log("Done.");
}

async function main() {
  console.log(`Testing tenant RLS against ${SUPABASE_URL}\nRun id: ${RUN_ID}\n`);

  console.log("Setting up test fixtures (org owner, admin, viewer, outsider)...");
  const owner = await makeUser("owner");
  const admin = await makeUser("admin");
  const viewer = await makeUser("viewer");
  const outsider = await makeUser("outsider");

  const orgSlug = `rls-test-org-${RUN_ID}`;
  const orgRes = await rest("POST", "organizations", {
    token: owner.token,
    body: { name: `RLS Test Org ${RUN_ID}`, slug: orgSlug },
  });
  if (!orgRes.ok || !orgRes.data?.[0]?.id) {
    throw new Error(`Could not create test organization: ${JSON.stringify(orgRes.data)}`);
  }
  const orgId = orgRes.data[0].id;
  createdOrgId = orgId;

  await rest("POST", "organization_members", {
    token: owner.token,
    body: { org_id: orgId, user_id: admin.id, role: "admin" },
  });
  await rest("POST", "organization_members", {
    token: owner.token,
    body: { org_id: orgId, user_id: viewer.id, role: "viewer" },
  });
  console.log("Fixtures ready.\n");

  // --- A. Cross-tenant isolation -------------------------------------
  console.log("A. Cross-tenant isolation");
  {
    const r = await rest("GET", "organizations", {
      token: outsider.token,
      query: `?id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read the organization row",
      r.ok && Array.isArray(r.data) && r.data.length === 0,
      `status ${r.status}, body ${JSON.stringify(r.data)}`,
    );

    const r2 = await rest("POST", "products", {
      token: outsider.token,
      body: { org_id: orgId, sku: `OUT-${RUN_ID}`, name: "Outsider product" },
    });
    check(
      "a non-member cannot insert into another org's products",
      !r2.ok,
      `expected failure, got status ${r2.status}`,
    );
  }

  // --- B. Viewer role is read-only ------------------------------------
  console.log("\nB. Viewer role is read-only (fix #4)");
  {
    const r = await rest("GET", "products", { token: viewer.token, query: `?org_id=eq.${orgId}` });
    check("viewer can read products", r.ok, `status ${r.status}`);

    const r2 = await rest("POST", "products", {
      token: viewer.token,
      body: { org_id: orgId, sku: `VIEWER-${RUN_ID}`, name: "Viewer-created product" },
    });
    check(
      "viewer CANNOT insert a product",
      !r2.ok,
      `expected failure, got status ${r2.status}, body ${JSON.stringify(r2.data)}`,
    );
  }

  // --- C. Admin cannot escalate to owner (fixes #1-#3) -----------------
  console.log("\nC. Admin cannot touch the owner role (fixes #1-#3)");
  {
    const r = await rest("PATCH", "organization_members", {
      token: admin.token,
      query: `?org_id=eq.${orgId}&user_id=eq.${admin.id}`,
      body: { role: "owner" },
    });
    const selfPromoted = r.ok && Array.isArray(r.data) && r.data.length > 0;
    check(
      "admin cannot promote themselves to owner (UPDATE)",
      !selfPromoted,
      `status ${r.status}, body ${JSON.stringify(r.data)}`,
    );

    const r2 = await rest("POST", "organization_members", {
      token: admin.token,
      body: { org_id: orgId, user_id: outsider.id, role: "owner" },
    });
    check(
      "admin cannot grant owner role to another user (INSERT)",
      !r2.ok,
      `status ${r2.status}, body ${JSON.stringify(r2.data)}`,
    );

    const r3 = await rest("DELETE", "organization_members", {
      token: admin.token,
      query: `?org_id=eq.${orgId}&user_id=eq.${owner.id}`,
    });
    const ownerRemoved = r3.ok && Array.isArray(r3.data) && r3.data.length > 0;
    check(
      "admin cannot remove the owner's membership (DELETE)",
      !ownerRemoved,
      `status ${r3.status}, body ${JSON.stringify(r3.data)}`,
    );

    const stillOwner = await rest("GET", "organization_members", {
      token: owner.token,
      query: `?org_id=eq.${orgId}&user_id=eq.${owner.id}&select=role`,
    });
    check(
      "owner's membership row still exists with role=owner",
      stillOwner.ok && stillOwner.data?.[0]?.role === "owner",
      `body ${JSON.stringify(stillOwner.data)}`,
    );
  }

  // --- D. Stock ledger is append-only (fix #5) -------------------------
  console.log("\nD. Stock movements are an immutable ledger (fix #5)");
  {
    const product = await rest("POST", "products", {
      token: owner.token,
      body: { org_id: orgId, sku: `LEDGER-${RUN_ID}`, name: "Ledger test product" },
    });
    const warehouse = await rest("POST", "warehouses", {
      token: owner.token,
      body: { org_id: orgId, name: "Test WH", code: `WH-${RUN_ID}` },
    });
    const productId = product.data?.[0]?.id;
    const warehouseId = warehouse.data?.[0]?.id;

    const movement = await rest("POST", "stock_movements", {
      token: owner.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "inbound",
        quantity: 10,
      },
    });
    check("owner can post a stock movement", movement.ok, `status ${movement.status}`);
    const movementId = movement.data?.[0]?.id;

    const patch = await rest("PATCH", "stock_movements", {
      token: owner.token,
      query: `?id=eq.${movementId}`,
      body: { quantity: 999 },
    });
    const patched = patch.ok && Array.isArray(patch.data) && patch.data.length > 0;
    check("even the owner cannot UPDATE a posted movement", !patched, `status ${patch.status}`);

    const del = await rest("DELETE", "stock_movements", {
      token: owner.token,
      query: `?id=eq.${movementId}`,
    });
    const deleted = del.ok && Array.isArray(del.data) && del.data.length > 0;
    check("even the owner cannot DELETE a posted movement", !deleted, `status ${del.status}`);
  }

  // --- E. Billing plan changes are owner-only (fix #6) ------------------
  console.log("\nE. Billing plan changes require owner (fix #6)");
  {
    const asAdmin = await rest("PATCH", "organizations", {
      token: admin.token,
      query: `?id=eq.${orgId}`,
      body: { plan: "growth" },
    });
    check(
      "admin cannot change the billing plan",
      !asAdmin.ok,
      `status ${asAdmin.status}, body ${JSON.stringify(asAdmin.data)}`,
    );

    const asOwner = await rest("PATCH", "organizations", {
      token: owner.token,
      query: `?id=eq.${orgId}`,
      body: { plan: "growth" },
    });
    check(
      "owner CAN change the billing plan",
      asOwner.ok && asOwner.data?.[0]?.plan === "growth",
      `status ${asOwner.status}, body ${JSON.stringify(asOwner.data)}`,
    );
  }

  // --- F. Workspace (organization) editing ------------------------------
  console.log("\nF. Workspace name/industry editing");
  {
    const asViewer = await rest("PATCH", "organizations", {
      token: viewer.token,
      query: `?id=eq.${orgId}`,
      body: { name: "Viewer Renamed Co" },
    });
    check(
      "viewer cannot rename the workspace",
      !asViewer.ok,
      `status ${asViewer.status}, body ${JSON.stringify(asViewer.data)}`,
    );

    const asAdmin = await rest("PATCH", "organizations", {
      token: admin.token,
      query: `?id=eq.${orgId}`,
      body: { name: "Renamed By Admin", industry: "Wholesale" },
    });
    check(
      "admin CAN rename the workspace and set its industry",
      asAdmin.ok &&
        asAdmin.data?.[0]?.name === "Renamed By Admin" &&
        asAdmin.data?.[0]?.industry === "Wholesale",
      `status ${asAdmin.status}, body ${JSON.stringify(asAdmin.data)}`,
    );
  }

  // --- G. Purchase order lifecycle + receiving RLS -----------------------
  console.log("\nG. Purchase orders: creation, cross-tenant isolation, receiving");
  {
    const supplier = await rest("POST", "suppliers", {
      token: admin.token,
      body: { org_id: orgId, name: `PO Supplier ${RUN_ID}` },
    });
    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "PO Test WH", code: `PO-WH-${RUN_ID}` },
    });
    const product = await rest("POST", "products", {
      token: admin.token,
      body: { org_id: orgId, sku: `PO-SKU-${RUN_ID}`, name: "PO test product", cost_price: 50 },
    });
    const supplierId = supplier.data?.[0]?.id;
    const warehouseId = warehouse.data?.[0]?.id;
    const productId = product.data?.[0]?.id;

    const viewerPoAttempt = await rest("POST", "purchase_orders", {
      token: viewer.token,
      body: {
        org_id: orgId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        po_number: `PO-VIEWER-${RUN_ID}`,
      },
    });
    check(
      "viewer cannot create a purchase order",
      !viewerPoAttempt.ok,
      `expected failure, got status ${viewerPoAttempt.status}`,
    );

    const po = await rest("POST", "purchase_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        po_number: `PO-${RUN_ID}`,
        total_amount: 500,
      },
    });
    check(
      "admin/staff can create a purchase order",
      po.ok,
      `status ${po.status}, body ${JSON.stringify(po.data)}`,
    );
    const poId = po.data?.[0]?.id;

    const item = await rest("POST", "purchase_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        purchase_order_id: poId,
        product_id: productId,
        quantity: 10,
        unit_cost: 50,
      },
    });
    check("admin can add a line item to the draft PO", item.ok, `status ${item.status}`);
    const itemId = item.data?.[0]?.id;

    const outsiderRead = await rest("GET", "purchase_orders", {
      token: outsider.token,
      query: `?id=eq.${poId}`,
    });
    check(
      "a non-member cannot read another org's purchase order",
      outsiderRead.ok && Array.isArray(outsiderRead.data) && outsiderRead.data.length === 0,
      `body ${JSON.stringify(outsiderRead.data)}`,
    );

    const outsiderEdit = await rest("PATCH", "purchase_orders", {
      token: outsider.token,
      query: `?id=eq.${poId}`,
      body: { notes: "hijacked" },
    });
    const outsiderEdited =
      outsiderEdit.ok && Array.isArray(outsiderEdit.data) && outsiderEdit.data.length > 0;
    check(
      "a non-member cannot edit another org's purchase order",
      !outsiderEdited,
      `status ${outsiderEdit.status}`,
    );

    const edit = await rest("PATCH", "purchase_orders", {
      token: admin.token,
      query: `?id=eq.${poId}`,
      body: { notes: "Edited before approval" },
    });
    check(
      "admin can edit their own org's draft purchase order",
      edit.ok && edit.data?.[0]?.notes === "Edited before approval",
      `status ${edit.status}`,
    );

    // Walk the PO to a receivable state the way the UI's status buttons do.
    await rest("PATCH", "purchase_orders", {
      token: admin.token,
      query: `?id=eq.${poId}`,
      body: { status: "approved" },
    });
    await rest("PATCH", "purchase_orders", {
      token: admin.token,
      query: `?id=eq.${poId}`,
      body: { status: "sent" },
    });

    const outsiderReceive = await rpc("receive_purchase_order_item", {
      token: outsider.token,
      body: { _item_id: itemId, _quantity: 5 },
    });
    check(
      "a non-member cannot receive stock against another org's PO item",
      !outsiderReceive.ok,
      `expected failure, got status ${outsiderReceive.status}, body ${JSON.stringify(outsiderReceive.data)}`,
    );

    const receive = await rpc("receive_purchase_order_item", {
      token: admin.token,
      body: { _item_id: itemId, _quantity: 10 },
    });
    check(
      "admin can receive the full ordered quantity",
      receive.ok,
      `status ${receive.status}, body ${JSON.stringify(receive.data)}`,
    );

    const poAfter = await rest("GET", "purchase_orders", {
      token: admin.token,
      query: `?id=eq.${poId}&select=status`,
    });
    check(
      "PO status rolls forward to received once fully received",
      poAfter.data?.[0]?.status === "received",
      `body ${JSON.stringify(poAfter.data)}`,
    );

    const stockAfter = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity`,
    });
    check(
      "receiving posted a stock movement that updated stock_levels",
      Number(stockAfter.data?.[0]?.quantity) === 10,
      `body ${JSON.stringify(stockAfter.data)}`,
    );
  }

  // --- H. Inventory state model: reserved/damaged/expired (SP-3) --------
  console.log("\nH. Inventory state model: reserved, damaged, expired stock");
  {
    const product = await rest("POST", "products", {
      token: admin.token,
      body: { org_id: orgId, sku: `INV-SKU-${RUN_ID}`, name: "Inventory state test product" },
    });
    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "Inventory Test WH", code: `INV-WH-${RUN_ID}` },
    });
    const productId = product.data?.[0]?.id;
    const warehouseId = warehouse.data?.[0]?.id;

    const outsiderMovement = await rest("POST", "stock_movements", {
      token: outsider.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "reserve",
        quantity: 5,
      },
    });
    check(
      "a non-member cannot post a reserve movement against another org's stock",
      !outsiderMovement.ok,
      `expected failure, got status ${outsiderMovement.status}`,
    );

    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "inbound",
        quantity: 100,
      },
    });
    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "reserve",
        quantity: 20,
      },
    });
    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "unreserve",
        quantity: 5,
      },
    });
    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "damage",
        quantity: 7,
      },
    });
    const expiredMovement = await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "expired",
        quantity: 3,
      },
    });
    check(
      "admin can post reserve/unreserve/damage/expired movements",
      expiredMovement.ok,
      `status ${expiredMovement.status}`,
    );

    const level = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity,reserved,damaged,expired`,
    });
    const row = level.data?.[0];
    check(
      "on hand is unaffected by reserve/damage/expired (stays at the inbound total)",
      Number(row?.quantity) === 100,
      `body ${JSON.stringify(row)}`,
    );
    check(
      "reserved nets to 15 after reserve 20 / unreserve 5",
      Number(row?.reserved) === 15,
      `body ${JSON.stringify(row)}`,
    );
    check("damaged is 7", Number(row?.damaged) === 7, `body ${JSON.stringify(row)}`);
    check("expired is 3", Number(row?.expired) === 3, `body ${JSON.stringify(row)}`);
    const available =
      Number(row?.quantity) - Number(row?.reserved) - Number(row?.damaged) - Number(row?.expired);
    check(
      "available = on_hand - reserved - damaged - expired = 75",
      available === 75,
      `computed ${available}`,
    );

    const movementId = expiredMovement.data?.[0]?.id;
    const patch = await rest("PATCH", "stock_movements", {
      token: admin.token,
      query: `?id=eq.${movementId}`,
      body: { quantity: 999 },
    });
    const patched = patch.ok && Array.isArray(patch.data) && patch.data.length > 0;
    check(
      "an 'expired' movement is append-only too — even the owner/admin cannot update it",
      !patched,
      `status ${patch.status}`,
    );

    const del = await rest("DELETE", "stock_movements", {
      token: admin.token,
      query: `?id=eq.${movementId}`,
    });
    const deleted = del.ok && Array.isArray(del.data) && del.data.length > 0;
    check("an 'expired' movement cannot be deleted either", !deleted, `status ${del.status}`);

    const outsiderRead = await rest("GET", "stock_levels", {
      token: outsider.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}`,
    });
    check(
      "a non-member cannot read another org's stock_levels (reserved/damaged/expired included)",
      outsiderRead.ok && Array.isArray(outsiderRead.data) && outsiderRead.data.length === 0,
      `body ${JSON.stringify(outsiderRead.data)}`,
    );
  }

  // --- I. Customers + Sales Orders: reservation lifecycle (SP-4) ---------
  console.log("\nI. Customers + Sales Orders: reservation lifecycle, isolation");
  {
    const customer = await rest("POST", "customers", {
      token: admin.token,
      body: { org_id: orgId, name: `Customer ${RUN_ID}`, state: "Maharashtra" },
    });
    check("admin can create a customer", customer.ok, `status ${customer.status}`);
    const customerId = customer.data?.[0]?.id;

    const viewerCustomerWrite = await rest("POST", "customers", {
      token: viewer.token,
      body: { org_id: orgId, name: "Viewer-created customer" },
    });
    check(
      "viewer cannot create a customer",
      !viewerCustomerWrite.ok,
      `status ${viewerCustomerWrite.status}`,
    );

    const outsiderCustomerRead = await rest("GET", "customers", {
      token: outsider.token,
      query: `?id=eq.${customerId}`,
    });
    check(
      "a non-member cannot read another org's customer",
      outsiderCustomerRead.ok &&
        Array.isArray(outsiderCustomerRead.data) &&
        outsiderCustomerRead.data.length === 0,
      `body ${JSON.stringify(outsiderCustomerRead.data)}`,
    );

    const product = await rest("POST", "products", {
      token: admin.token,
      body: {
        org_id: orgId,
        sku: `SO-SKU-${RUN_ID}`,
        name: "SO test product",
        selling_price: 100,
        tax_rate: 18,
      },
    });
    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "SO Test WH", code: `SO-WH-${RUN_ID}` },
    });
    const productId = product.data?.[0]?.id;
    const warehouseId = warehouse.data?.[0]?.id;

    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "inbound",
        quantity: 10,
      },
    });

    const numberResult = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    check(
      "next_sales_order_number mints a per-financial-year number",
      numberResult.ok &&
        typeof numberResult.data === "string" &&
        numberResult.data.startsWith("SO/"),
      `status ${numberResult.status}, body ${JSON.stringify(numberResult.data)}`,
    );

    const viewerSoAttempt = await rest("POST", "sales_orders", {
      token: viewer.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: `SO-VIEWER-${RUN_ID}`,
      },
    });
    check(
      "viewer cannot create a sales order",
      !viewerSoAttempt.ok,
      `status ${viewerSoAttempt.status}`,
    );

    const so = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: numberResult.data,
        subtotal: 1500,
        total_amount: 1770,
      },
    });
    check(
      "admin can create a draft sales order",
      so.ok,
      `status ${so.status}, body ${JSON.stringify(so.data)}`,
    );
    const soId = so.data?.[0]?.id;

    const item = await rest("POST", "sales_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        sales_order_id: soId,
        product_id: productId,
        quantity: 15,
        unit_price: 100,
        tax_rate: 18,
      },
    });
    check("admin can add a line item to the draft SO", item.ok, `status ${item.status}`);
    const itemId = item.data?.[0]?.id;

    const outsiderSoRead = await rest("GET", "sales_orders", {
      token: outsider.token,
      query: `?id=eq.${soId}`,
    });
    check(
      "a non-member cannot read another org's sales order",
      outsiderSoRead.ok && Array.isArray(outsiderSoRead.data) && outsiderSoRead.data.length === 0,
      `body ${JSON.stringify(outsiderSoRead.data)}`,
    );

    const viewerConfirm = await rpc("confirm_sales_order", {
      token: viewer.token,
      body: { _so_id: soId },
    });
    check(
      "viewer cannot confirm a sales order",
      !viewerConfirm.ok,
      `status ${viewerConfirm.status}`,
    );

    // The line asks for 15 but only 10 are on hand — confirmation must be
    // blocked, and blocked entirely (no partial reservation).
    const shortConfirm = await rpc("confirm_sales_order", {
      token: admin.token,
      body: { _so_id: soId },
    });
    check(
      "confirming is blocked when a line exceeds available stock",
      !shortConfirm.ok,
      `expected failure, got status ${shortConfirm.status}, body ${JSON.stringify(shortConfirm.data)}`,
    );
    check(
      "the blocked-confirm error names the short product and quantities",
      typeof shortConfirm.data?.message === "string" &&
        shortConfirm.data.message.includes("SO-SKU") &&
        shortConfirm.data.message.includes("15") &&
        shortConfirm.data.message.includes("10"),
      `body ${JSON.stringify(shortConfirm.data)}`,
    );

    const levelAfterBlock = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity,reserved`,
    });
    check(
      "a blocked confirmation reserves nothing at all",
      Number(levelAfterBlock.data?.[0]?.reserved) === 0 &&
        Number(levelAfterBlock.data?.[0]?.quantity) === 10,
      `body ${JSON.stringify(levelAfterBlock.data)}`,
    );

    // Bring the line down to something the warehouse can actually cover.
    await rest("PATCH", "sales_order_items", {
      token: admin.token,
      query: `?id=eq.${itemId}`,
      body: { quantity: 5 },
    });

    const confirm = await rpc("confirm_sales_order", {
      token: admin.token,
      body: { _so_id: soId },
    });
    check(
      "admin can confirm once the line fits available stock",
      confirm.ok,
      `status ${confirm.status}, body ${JSON.stringify(confirm.data)}`,
    );

    const levelAfterConfirm = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity,reserved`,
    });
    check(
      "confirming reserves the line quantity without touching on_hand",
      Number(levelAfterConfirm.data?.[0]?.reserved) === 5 &&
        Number(levelAfterConfirm.data?.[0]?.quantity) === 10,
      `body ${JSON.stringify(levelAfterConfirm.data)}`,
    );

    const ship = await rpc("ship_sales_order", { token: admin.token, body: { _so_id: soId } });
    check(
      "admin can ship a confirmed order",
      ship.ok,
      `status ${ship.status}, body ${JSON.stringify(ship.data)}`,
    );

    const levelAfterShip = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity,reserved`,
    });
    check(
      "shipping decrements on_hand and clears the reservation",
      Number(levelAfterShip.data?.[0]?.reserved) === 0 &&
        Number(levelAfterShip.data?.[0]?.quantity) === 5,
      `body ${JSON.stringify(levelAfterShip.data)}`,
    );

    const soAfterShip = await rest("GET", "sales_orders", {
      token: admin.token,
      query: `?id=eq.${soId}&select=status`,
    });
    check(
      "order status is shipped",
      soAfterShip.data?.[0]?.status === "shipped",
      `body ${JSON.stringify(soAfterShip.data)}`,
    );

    // A second, smaller order to prove cancellation releases a reservation
    // with no stock-out.
    const number2 = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    const so2 = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: number2.data,
        subtotal: 300,
        total_amount: 354,
      },
    });
    const so2Id = so2.data?.[0]?.id;
    await rest("POST", "sales_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        sales_order_id: so2Id,
        product_id: productId,
        quantity: 3,
        unit_price: 100,
        tax_rate: 18,
      },
    });
    await rpc("confirm_sales_order", { token: admin.token, body: { _so_id: so2Id } });

    const cancel = await rpc("cancel_sales_order", { token: admin.token, body: { _so_id: so2Id } });
    check(
      "admin can cancel a confirmed order",
      cancel.ok,
      `status ${cancel.status}, body ${JSON.stringify(cancel.data)}`,
    );

    const levelAfterCancel = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity,reserved`,
    });
    check(
      "cancelling releases the reservation without a stock-out",
      Number(levelAfterCancel.data?.[0]?.reserved) === 0 &&
        Number(levelAfterCancel.data?.[0]?.quantity) === 5,
      `body ${JSON.stringify(levelAfterCancel.data)}`,
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
    if (err instanceof NeedsServiceRoleKeyError) {
      // Not a policy failure — the suite simply can't authenticate its own
      // fixtures yet. Skip cleanly rather than failing CI on a missing
      // secret that hasn't been configured.
      console.warn(`\nSkipping RLS suite: ${err.message}`);
      process.exit(0);
    }
    console.error("\nSuite errored out:", err.message);
    process.exit(1);
  });
