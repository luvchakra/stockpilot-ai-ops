#!/usr/bin/env node
// Integration test suite for the multi-tenant RLS hardening
// (supabase/migrations/20260830130000_harden_tenant_rls.sql) plus RLS
// coverage for features added since: workspace editing, the
// purchase-order create/edit/receive workflow, the reserved/damaged/
// expired inventory state model, sales orders, sales invoicing + credit
// notes, the granular roles/permissions model (SP-6), and the audit log
// (SP-2).
//
// Exercises the live Supabase project over its REST/Auth API — no
// @supabase/supabase-js needed, just Node's built-in fetch, so it runs
// with zero `npm install`.
//
// WHAT THIS CREATES: 7 throwaway auth users (emails tagged
// rls-test-<run>-*@test.stockpilot.invalid), 1 organization, and a
// handful of rows under it (products, warehouses, suppliers, purchase
// orders and their line items, sales orders, stock movements).
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
  // Default to asking for the row back, but let a caller opt out (extraHeaders)
  // — needed for tables like *_credentials that deliberately have no SELECT
  // policy for `authenticated`: RETURNING is itself subject to RLS, so
  // requesting a representation there fails even when the write itself is
  // permitted. The real app avoids this by never chaining .select().
  if (method !== "GET" && !headers.Prefer) headers.Prefer = "return=representation";

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
    // A blocked RLS UPDATE isn't an error status — PostgREST returns 200
    // with zero rows when the USING clause matches nothing, so the real
    // signal is an empty result, not a non-2xx response.
    const viewerRenamed = asViewer.ok && asViewer.data?.length > 0;
    check(
      "viewer cannot rename the workspace",
      !viewerRenamed,
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
    // --- J. Sales Invoices + Credit Notes (SP-5) ---------------------------
    // Deliberately not a separate block: it reuses I's productId/customerId/
    // warehouseId/soId fixtures (a shipped sales order to invoice against),
    // so it has to share I's lexical scope rather than opening its own.
    console.log("\nJ. Sales invoices + credit notes: generation rules, isolation");
    await rest("PATCH", "products", {
      token: admin.token,
      query: `?id=eq.${productId}`,
      body: { hsn_code: "9999" },
    });

    const draftSoNumber = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    const draftSo = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: draftSoNumber.data,
        subtotal: 100,
        total_amount: 118,
      },
    });
    const draftSoId = draftSo.data?.[0]?.id;

    const draftInvoiceAttempt = await rpc("generate_sales_invoice", {
      token: admin.token,
      body: { _so_id: draftSoId },
    });
    check(
      "an invoice cannot be generated from a draft sales order",
      !draftInvoiceAttempt.ok,
      `expected failure, got status ${draftInvoiceAttempt.status}, body ${JSON.stringify(draftInvoiceAttempt.data)}`,
    );

    const viewerInvoiceAttempt = await rpc("generate_sales_invoice", {
      token: viewer.token,
      body: { _so_id: soId },
    });
    check(
      "viewer cannot generate an invoice",
      !viewerInvoiceAttempt.ok,
      `status ${viewerInvoiceAttempt.status}`,
    );

    const genInvoice = await rpc("generate_sales_invoice", {
      token: admin.token,
      body: { _so_id: soId },
    });
    check(
      "admin can generate an invoice from a shipped sales order",
      genInvoice.ok,
      `status ${genInvoice.status}, body ${JSON.stringify(genInvoice.data)}`,
    );
    const invoiceId = genInvoice.data;

    const dupInvoice = await rpc("generate_sales_invoice", {
      token: admin.token,
      body: { _so_id: soId },
    });
    check(
      "generating a second invoice for the same order is blocked",
      !dupInvoice.ok,
      `expected failure, got status ${dupInvoice.status}`,
    );

    const invoiceRow = await rest("GET", "sales_invoices", {
      token: admin.token,
      query: `?id=eq.${invoiceId}&select=invoice_number,subtotal,sales_order_id`,
    });
    check(
      "the invoice is numbered per financial year and snapshots the order's totals",
      invoiceRow.data?.[0]?.invoice_number?.startsWith("INV/") &&
        Number(invoiceRow.data?.[0]?.subtotal) === 1500 &&
        invoiceRow.data?.[0]?.sales_order_id === soId,
      `body ${JSON.stringify(invoiceRow.data)}`,
    );

    const invoiceItems = await rest("GET", "sales_invoice_items", {
      token: admin.token,
      query: `?invoice_id=eq.${invoiceId}&select=product_id,hsn_code,quantity`,
    });
    check(
      "invoice line items are copied from the sales order with the product's HSN code",
      invoiceItems.data?.length === 1 &&
        invoiceItems.data[0].product_id === productId &&
        invoiceItems.data[0].hsn_code === "9999",
      `body ${JSON.stringify(invoiceItems.data)}`,
    );

    const outsiderInvoiceRead = await rest("GET", "sales_invoices", {
      token: outsider.token,
      query: `?id=eq.${invoiceId}`,
    });
    check(
      "a non-member cannot read another org's invoice",
      outsiderInvoiceRead.ok &&
        Array.isArray(outsiderInvoiceRead.data) &&
        outsiderInvoiceRead.data.length === 0,
      `body ${JSON.stringify(outsiderInvoiceRead.data)}`,
    );

    const viewerCreditAttempt = await rpc("create_credit_note", {
      token: viewer.token,
      body: { _invoice_id: invoiceId, _is_full: false, _subtotal: 100 },
    });
    check(
      "viewer cannot record a credit note",
      !viewerCreditAttempt.ok,
      `status ${viewerCreditAttempt.status}`,
    );

    const overCredit = await rpc("create_credit_note", {
      token: admin.token,
      body: { _invoice_id: invoiceId, _is_full: false, _subtotal: 999999 },
    });
    check(
      "a credit note cannot exceed the invoice's remaining taxable value",
      !overCredit.ok,
      `expected failure, got status ${overCredit.status}, body ${JSON.stringify(overCredit.data)}`,
    );

    const partialCredit = await rpc("create_credit_note", {
      token: admin.token,
      body: { _invoice_id: invoiceId, _is_full: false, _subtotal: 500, _reason: "Partial return" },
    });
    check(
      "admin can record a partial credit note",
      partialCredit.ok,
      `status ${partialCredit.status}, body ${JSON.stringify(partialCredit.data)}`,
    );

    const fullCredit = await rpc("create_credit_note", {
      token: admin.token,
      body: { _invoice_id: invoiceId, _is_full: true },
    });
    check(
      "admin can then record a full credit note for the remainder",
      fullCredit.ok,
      `status ${fullCredit.status}, body ${JSON.stringify(fullCredit.data)}`,
    );

    const creditNotesRows = await rest("GET", "credit_notes", {
      token: admin.token,
      query: `?sales_invoice_id=eq.${invoiceId}&select=subtotal,credit_note_number`,
    });
    const totalCredited = (creditNotesRows.data ?? []).reduce(
      (s, cn) => s + Number(cn.subtotal),
      0,
    );
    check(
      "the two credit notes together account for the full invoice subtotal (1500)",
      totalCredited === 1500 &&
        (creditNotesRows.data ?? []).every((cn) => cn.credit_note_number?.startsWith("CN/")),
      `body ${JSON.stringify(creditNotesRows.data)}`,
    );

    const noMoreCredit = await rpc("create_credit_note", {
      token: admin.token,
      body: { _invoice_id: invoiceId, _is_full: true },
    });
    check(
      "a fully-credited invoice cannot be credited again",
      !noMoreCredit.ok,
      `expected failure, got status ${noMoreCredit.status}`,
    );
  }

  // --- K. Granular Roles & Permissions (SP-6) -----------------------------
  console.log(
    "\nK. Granular roles: sales_manager, accountant, warehouse_operator, viewer write-block",
  );
  {
    const salesManager = await makeUser("salesmgr");
    const accountant = await makeUser("accountant");
    const warehouseOp = await makeUser("whop");

    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: salesManager.id, role: "sales_manager" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: accountant.id, role: "accountant" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: warehouseOp.id, role: "warehouse_operator" },
    });

    const supplier = await rest("POST", "suppliers", {
      token: admin.token,
      body: { org_id: orgId, name: `K Supplier ${RUN_ID}` },
    });
    const supplierId = supplier.data?.[0]?.id;

    // This section needs its own customer/warehouse/product (not I's —
    // that block has already closed) with enough opening stock for
    // confirm_sales_order below to find available quantity to reserve.
    const customer = await rest("POST", "customers", {
      token: admin.token,
      body: { org_id: orgId, name: `K Customer ${RUN_ID}`, state: "Maharashtra" },
    });
    const customerId = customer.data?.[0]?.id;
    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "K Test WH", code: `K-WH-${RUN_ID}` },
    });
    const warehouseId = warehouse.data?.[0]?.id;
    const product = await rest("POST", "products", {
      token: admin.token,
      body: {
        org_id: orgId,
        sku: `K-SKU-${RUN_ID}`,
        name: "K test product",
        selling_price: 100,
        tax_rate: 18,
      },
    });
    const productId = product.data?.[0]?.id;
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

    // Sales Manager can confirm a sales order...
    const smSoNumber = await rpc("next_sales_order_number", {
      token: salesManager.token,
      body: { _org_id: orgId },
    });
    const smSo = await rest("POST", "sales_orders", {
      token: salesManager.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: smSoNumber.data,
        subtotal: 200,
        total_amount: 236,
      },
    });
    check(
      "sales_manager can create a draft sales order",
      smSo.ok,
      `status ${smSo.status}, body ${JSON.stringify(smSo.data)}`,
    );
    const smSoId = smSo.data?.[0]?.id;
    await rest("POST", "sales_order_items", {
      token: salesManager.token,
      body: {
        org_id: orgId,
        sales_order_id: smSoId,
        product_id: productId,
        quantity: 2,
        unit_price: 100,
        tax_rate: 18,
      },
    });
    const smConfirm = await rpc("confirm_sales_order", {
      token: salesManager.token,
      body: { _so_id: smSoId },
    });
    check(
      "sales_manager CAN confirm a sales order",
      smConfirm.ok,
      `status ${smConfirm.status}, body ${JSON.stringify(smConfirm.data)}`,
    );

    // ...but cannot approve a purchase order (acceptance criterion).
    const draftPo = await rest("POST", "purchase_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        po_number: `PO-K-${RUN_ID}`,
      },
    });
    const poId = draftPo.data?.[0]?.id;
    const poItem = await rest("POST", "purchase_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        purchase_order_id: poId,
        product_id: productId,
        quantity: 10,
        unit_cost: 50,
      },
    });
    const poItemId = poItem.data?.[0]?.id;

    const smApprovePo = await rest("PATCH", "purchase_orders", {
      token: salesManager.token,
      query: `?id=eq.${poId}`,
      body: { status: "approved" },
    });
    const poApprovedBySm = smApprovePo.ok && smApprovePo.data?.length > 0;
    check(
      "sales_manager CANNOT approve a purchase order",
      !poApprovedBySm,
      `status ${smApprovePo.status}, body ${JSON.stringify(smApprovePo.data)}`,
    );

    // Accountant can create an invoice (acceptance criterion) — smSoId is
    // already confirmed, which is invoiceable.
    const acctInvoice = await rpc("generate_sales_invoice", {
      token: accountant.token,
      body: { _so_id: smSoId },
    });
    check(
      "accountant CAN create an invoice",
      acctInvoice.ok,
      `status ${acctInvoice.status}, body ${JSON.stringify(acctInvoice.data)}`,
    );

    // ...but cannot adjust inventory (acceptance criterion).
    const acctInventoryWrite = await rest("PATCH", "products", {
      token: accountant.token,
      query: `?id=eq.${productId}`,
      body: { selling_price: 9999 },
    });
    const inventoryChangedByAccountant =
      acctInventoryWrite.ok && acctInventoryWrite.data?.length > 0;
    check(
      "accountant CANNOT adjust inventory",
      !inventoryChangedByAccountant,
      `status ${acctInventoryWrite.status}, body ${JSON.stringify(acctInventoryWrite.data)}`,
    );

    // Viewer cannot perform any write action anywhere (acceptance criterion) —
    // spot-check beyond products (already covered in section B).
    const viewerSoWrite = await rest("POST", "sales_orders", {
      token: viewer.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: `SO-VIEWER-K-${RUN_ID}`,
      },
    });
    check(
      "viewer cannot create a sales order",
      !viewerSoWrite.ok,
      `status ${viewerSoWrite.status}`,
    );

    const viewerInvoiceWrite = await rpc("generate_sales_invoice", {
      token: viewer.token,
      body: { _so_id: smSoId },
    });
    check(
      "viewer cannot generate an invoice",
      !viewerInvoiceWrite.ok,
      `status ${viewerInvoiceWrite.status}`,
    );

    const viewerPoWrite = await rest("POST", "purchase_orders", {
      token: viewer.token,
      body: {
        org_id: orgId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        po_number: `PO-VIEWER-K-${RUN_ID}`,
      },
    });
    check(
      "viewer cannot create a purchase order",
      !viewerPoWrite.ok,
      `status ${viewerPoWrite.status}`,
    );

    // Warehouse Operator persona: receives stock and ships orders, but must
    // not see cost prices, approve purchase orders, or confirm/cancel
    // sales orders.
    const woProductsSafe = await rest("GET", "products_safe", {
      token: warehouseOp.token,
      query: `?id=eq.${productId}&select=id,cost_price`,
    });
    check(
      "warehouse_operator sees a masked (null) cost_price via products_safe",
      woProductsSafe.ok && woProductsSafe.data?.[0]?.cost_price === null,
      `body ${JSON.stringify(woProductsSafe.data)}`,
    );

    const adminProductsSafe = await rest("GET", "products_safe", {
      token: admin.token,
      query: `?id=eq.${productId}&select=id,cost_price`,
    });
    check(
      "admin sees the real cost_price via products_safe",
      adminProductsSafe.ok && adminProductsSafe.data?.[0]?.cost_price !== null,
      `body ${JSON.stringify(adminProductsSafe.data)}`,
    );

    const po2 = await rest("POST", "purchase_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        po_number: `PO-K2-${RUN_ID}`,
      },
    });
    const po2Id = po2.data?.[0]?.id;
    const woApproveAttempt = await rest("PATCH", "purchase_orders", {
      token: warehouseOp.token,
      query: `?id=eq.${po2Id}`,
      body: { status: "approved" },
    });
    const po2ApprovedByWo = woApproveAttempt.ok && woApproveAttempt.data?.length > 0;
    check(
      "warehouse_operator CANNOT approve a purchase order",
      !po2ApprovedByWo,
      `status ${woApproveAttempt.status}, body ${JSON.stringify(woApproveAttempt.data)}`,
    );

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
    const woReceive = await rpc("receive_purchase_order_item", {
      token: warehouseOp.token,
      body: { _item_id: poItemId, _quantity: 4 },
    });
    check(
      "warehouse_operator CAN receive against a purchase order",
      woReceive.ok,
      `status ${woReceive.status}, body ${JSON.stringify(woReceive.data)}`,
    );

    const woShip = await rpc("ship_sales_order", {
      token: warehouseOp.token,
      body: { _so_id: smSoId },
    });
    check(
      "warehouse_operator CAN ship a confirmed sales order",
      woShip.ok,
      `status ${woShip.status}, body ${JSON.stringify(woShip.data)}`,
    );

    const soForWo = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: `SO-WO-${RUN_ID}`,
        subtotal: 100,
        total_amount: 118,
      },
    });
    const soForWoId = soForWo.data?.[0]?.id;
    await rest("POST", "sales_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        sales_order_id: soForWoId,
        product_id: productId,
        quantity: 1,
        unit_price: 100,
        tax_rate: 18,
      },
    });

    const woConfirmAttempt = await rpc("confirm_sales_order", {
      token: warehouseOp.token,
      body: { _so_id: soForWoId },
    });
    check(
      "warehouse_operator CANNOT confirm a sales order",
      !woConfirmAttempt.ok,
      `status ${woConfirmAttempt.status}`,
    );

    const woCancelAttempt = await rpc("cancel_sales_order", {
      token: warehouseOp.token,
      body: { _so_id: soForWoId },
    });
    check(
      "warehouse_operator CANNOT cancel a sales order",
      !woCancelAttempt.ok,
      `status ${woCancelAttempt.status}`,
    );

    // The Team page's data model: role_permissions is readable by any
    // authenticated user (it's not org-scoped) and correctly separates
    // sales_manager's confirm permission from purchase_orders.approve.
    const rolePerms = await rest("GET", "role_permissions", {
      token: viewer.token,
      query: `?role=eq.sales_manager&select=permission_key`,
    });
    const smKeys = (rolePerms.data ?? []).map((r) => r.permission_key);
    check(
      "role_permissions grants sales_manager sales_orders.confirm but not purchase_orders.approve",
      smKeys.includes("sales_orders.confirm") && !smKeys.includes("purchase_orders.approve"),
      `body ${JSON.stringify(rolePerms.data)}`,
    );
  }

  // --- L. Audit Log (SP-2) -------------------------------------------------
  console.log("\nL. Audit log: PO status / stock adjustment / org settings triggers, isolation");
  {
    const supplier = await rest("POST", "suppliers", {
      token: admin.token,
      body: { org_id: orgId, name: `L Supplier ${RUN_ID}` },
    });
    const supplierId = supplier.data?.[0]?.id;
    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "Audit Test WH", code: `AUDIT-WH-${RUN_ID}` },
    });
    const warehouseId = warehouse.data?.[0]?.id;
    const product = await rest("POST", "products", {
      token: admin.token,
      body: { org_id: orgId, sku: `AUDIT-SKU-${RUN_ID}`, name: "Audit test product" },
    });
    const productId = product.data?.[0]?.id;

    // PO status transition is audited.
    const po = await rest("POST", "purchase_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        po_number: `PO-AUDIT-${RUN_ID}`,
      },
    });
    const poId = po.data?.[0]?.id;
    await rest("PATCH", "purchase_orders", {
      token: admin.token,
      query: `?id=eq.${poId}`,
      body: { status: "approved" },
    });

    const poAudit = await rest("GET", "audit_log", {
      token: admin.token,
      query: `?entity_type=eq.purchase_order&entity_id=eq.${poId}&select=action,before,after,actor_id`,
    });
    check(
      "a PO status change is recorded in the audit log",
      poAudit.ok &&
        poAudit.data?.length === 1 &&
        poAudit.data[0].action === "purchase_order.status_changed" &&
        poAudit.data[0].before?.status === "draft" &&
        poAudit.data[0].after?.status === "approved" &&
        poAudit.data[0].actor_id === admin.id,
      `body ${JSON.stringify(poAudit.data)}`,
    );

    // Stock adjustment is audited, with its reason...
    const adjustment = await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "adjustment",
        quantity: 3,
        notes: "cycle count correction",
      },
    });
    const adjustmentId = adjustment.data?.[0]?.id;
    const adjAudit = await rest("GET", "audit_log", {
      token: admin.token,
      query: `?entity_type=eq.stock_movement&entity_id=eq.${adjustmentId}&select=action,after`,
    });
    check(
      "a stock adjustment (with reason) is recorded in the audit log",
      adjAudit.ok &&
        adjAudit.data?.length === 1 &&
        adjAudit.data[0].action === "stock.adjusted" &&
        adjAudit.data[0].after?.reason === "cycle count correction",
      `body ${JSON.stringify(adjAudit.data)}`,
    );

    // ...but a routine inbound movement is not (it's not a human correction).
    const inbound = await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "inbound",
        quantity: 10,
      },
    });
    const inboundId = inbound.data?.[0]?.id;
    const inboundAudit = await rest("GET", "audit_log", {
      token: admin.token,
      query: `?entity_id=eq.${inboundId}`,
    });
    check(
      "a routine inbound movement is NOT recorded in the audit log",
      inboundAudit.ok && inboundAudit.data?.length === 0,
      `body ${JSON.stringify(inboundAudit.data)}`,
    );

    // Org settings change is audited.
    await rest("PATCH", "organizations", {
      token: admin.token,
      query: `?id=eq.${orgId}`,
      body: { timezone: "Asia/Dubai" },
    });
    const orgAudit = await rest("GET", "audit_log", {
      token: admin.token,
      query: `?entity_type=eq.organization&action=eq.organization.settings_changed&select=before,after&order=created_at.desc&limit=1`,
    });
    check(
      "an organization settings change is recorded in the audit log",
      orgAudit.ok &&
        orgAudit.data?.length === 1 &&
        orgAudit.data[0].after?.timezone === "Asia/Dubai",
      `body ${JSON.stringify(orgAudit.data)}`,
    );

    // Cross-tenant isolation and no client write path at all.
    const outsiderAuditRead = await rest("GET", "audit_log", {
      token: outsider.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read another org's audit log",
      outsiderAuditRead.ok &&
        Array.isArray(outsiderAuditRead.data) &&
        outsiderAuditRead.data.length === 0,
      `body ${JSON.stringify(outsiderAuditRead.data)}`,
    );

    const memberAuditInsert = await rest("POST", "audit_log", {
      token: admin.token,
      body: { org_id: orgId, actor_id: admin.id, action: "fake", entity_type: "fake", after: {} },
    });
    check(
      "even an admin cannot insert an audit_log row directly (no client write path)",
      !memberAuditInsert.ok,
      `expected failure, got status ${memberAuditInsert.status}`,
    );

    const memberAuditUpdate = await rest("PATCH", "audit_log", {
      token: admin.token,
      query: `?entity_id=eq.${poId}`,
      body: { action: "tampered" },
    });
    const tampered = memberAuditUpdate.ok && memberAuditUpdate.data?.length > 0;
    check(
      "an existing audit_log row cannot be edited via the client API",
      !tampered,
      `status ${memberAuditUpdate.status}, body ${JSON.stringify(memberAuditUpdate.data)}`,
    );

    const memberAuditDelete = await rest("DELETE", "audit_log", {
      token: admin.token,
      query: `?entity_id=eq.${poId}`,
    });
    const deleted = memberAuditDelete.ok && memberAuditDelete.data?.length > 0;
    check(
      "an existing audit_log row cannot be deleted via the client API",
      !deleted,
      `status ${memberAuditDelete.status}, body ${JSON.stringify(memberAuditDelete.data)}`,
    );
  }

  // --- M. e-Way Bills (SP-7) ------------------------------------------------
  console.log("\nM. e-Way Bills: generate/cancel permission gating, credential secrecy, isolation");
  {
    const salesManager = await makeUser("ewbsales");
    const warehouseOp = await makeUser("ewbwhop");
    const viewer = await makeUser("ewbviewer");

    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: salesManager.id, role: "sales_manager" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: warehouseOp.id, role: "warehouse_operator" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: viewer.id, role: "viewer" },
    });

    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "e-Way Bill Test WH", code: `EWB-WH-${RUN_ID}` },
    });
    const warehouseId = warehouse.data?.[0]?.id;
    const customer = await rest("POST", "customers", {
      token: admin.token,
      body: { org_id: orgId, name: `M Customer ${RUN_ID}` },
    });
    const customerId = customer.data?.[0]?.id;

    const soNumber = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    const so = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: soNumber.data,
        subtotal: 60000,
        total_amount: 70800,
      },
    });
    const soId = so.data?.[0]?.id;

    const ewbPayload = () => ({
      org_id: orgId,
      source_type: "sales_order",
      source_id: soId,
      ewb_number: `EWB${RUN_ID}`,
      ewb_date: new Date().toISOString(),
      valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      transport_mode: "road",
      request_payload: {},
      response_payload: {},
    });

    // A role without eway_bills.generate (viewer) cannot record a generated bill.
    const viewerGenerate = await rest("POST", "eway_bills", {
      token: viewer.token,
      body: ewbPayload(),
    });
    check(
      "viewer cannot record an e-Way Bill (lacks eway_bills.generate)",
      !viewerGenerate.ok,
      `status ${viewerGenerate.status}, body ${JSON.stringify(viewerGenerate.data)}`,
    );

    // sales_manager (has eway_bills.generate) can.
    const smGenerate = await rest("POST", "eway_bills", {
      token: salesManager.token,
      body: ewbPayload(),
    });
    check(
      "sales_manager can record a generated e-Way Bill",
      smGenerate.ok,
      `status ${smGenerate.status}, body ${JSON.stringify(smGenerate.data)}`,
    );
    const billId = smGenerate.data?.[0]?.id;

    // Only one ACTIVE bill per source transaction at a time.
    const duplicateGenerate = await rest("POST", "eway_bills", {
      token: salesManager.token,
      body: ewbPayload(),
    });
    check(
      "a second active e-Way Bill for the same source transaction is rejected",
      !duplicateGenerate.ok,
      `status ${duplicateGenerate.status}, body ${JSON.stringify(duplicateGenerate.data)}`,
    );

    // A role without eway_bills.cancel (viewer) cannot cancel.
    const viewerCancel = await rest("PATCH", "eway_bills", {
      token: viewer.token,
      query: `?id=eq.${billId}`,
      body: { status: "cancelled", cancelled_at: new Date().toISOString() },
    });
    const viewerCancelled = viewerCancel.ok && viewerCancel.data?.length > 0;
    check(
      "viewer cannot cancel an e-Way Bill (lacks eway_bills.cancel)",
      !viewerCancelled,
      `status ${viewerCancel.status}, body ${JSON.stringify(viewerCancel.data)}`,
    );

    // warehouse_operator (has eway_bills.cancel) can.
    const whopCancel = await rest("PATCH", "eway_bills", {
      token: warehouseOp.token,
      query: `?id=eq.${billId}`,
      body: { status: "cancelled", cancelled_at: new Date().toISOString() },
    });
    check(
      "warehouse_operator can cancel an e-Way Bill",
      whopCancel.ok && whopCancel.data?.length > 0,
      `status ${whopCancel.status}, body ${JSON.stringify(whopCancel.data)}`,
    );

    // Cancelling frees the source transaction up for a fresh generation.
    const regenerate = await rest("POST", "eway_bills", {
      token: salesManager.token,
      body: ewbPayload(),
    });
    check(
      "a new e-Way Bill can be generated after the prior one is cancelled",
      regenerate.ok,
      `status ${regenerate.status}, body ${JSON.stringify(regenerate.data)}`,
    );

    // No DELETE policy at all -- a generated bill is a permanent legal record.
    const deleteAttempt = await rest("DELETE", "eway_bills", {
      token: admin.token,
      query: `?id=eq.${billId}`,
    });
    const wasDeleted = deleteAttempt.ok && deleteAttempt.data?.length > 0;
    check(
      "an e-Way Bill row cannot be deleted via the client API",
      !wasDeleted,
      `status ${deleteAttempt.status}, body ${JSON.stringify(deleteAttempt.data)}`,
    );

    // Cross-tenant isolation.
    const outsiderRead = await rest("GET", "eway_bills", {
      token: outsider.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read another org's e-Way Bills",
      outsiderRead.ok && Array.isArray(outsiderRead.data) && outsiderRead.data.length === 0,
      `body ${JSON.stringify(outsiderRead.data)}`,
    );

    // --- Credentials: no client SELECT path for anyone, writes gated by settings.manage ---
    // return=minimal: this table has no SELECT policy for `authenticated` by
    // design, and RETURNING is itself subject to RLS, so asking for the row
    // back would fail even though the write itself is permitted.
    const credInsert = await rest("POST", "eway_bill_credentials", {
      token: admin.token,
      extraHeaders: { Prefer: "return=minimal" },
      body: {
        org_id: orgId,
        gsp_provider: "TestGSP",
        auth_url: "https://example.test/auth",
        generate_url: "https://example.test/generate",
        cancel_url: "https://example.test/cancel",
        gsp_username: "test-user",
        gsp_password: "super-secret",
      },
    });
    check(
      "admin (settings.manage) can save e-Way Bill credentials",
      credInsert.ok,
      `status ${credInsert.status}, body ${JSON.stringify(credInsert.data)}`,
    );

    const smCredUpdate = await rest("PATCH", "eway_bill_credentials", {
      token: salesManager.token,
      query: `?org_id=eq.${orgId}`,
      body: { gsp_provider: "Hijacked" },
    });
    const smTampered = smCredUpdate.ok && smCredUpdate.data?.length > 0;
    check(
      "sales_manager (lacks settings.manage) cannot update e-Way Bill credentials",
      !smTampered,
      `status ${smCredUpdate.status}, body ${JSON.stringify(smCredUpdate.data)}`,
    );

    const adminCredRead = await rest("GET", "eway_bill_credentials", {
      token: admin.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "even an org admin cannot SELECT e-Way Bill credentials directly (service_role only)",
      adminCredRead.ok && Array.isArray(adminCredRead.data) && adminCredRead.data.length === 0,
      `status ${adminCredRead.status}, body ${JSON.stringify(adminCredRead.data)}`,
    );

    const statusRpc = await rpc("eway_bill_credentials_status", {
      token: viewer.token,
      body: { _org: orgId },
    });
    const statusRow = statusRpc.data?.[0];
    check(
      "eway_bill_credentials_status() exposes only non-secret metadata to org members",
      statusRpc.ok &&
        statusRow?.gsp_provider === "TestGSP" &&
        !("gsp_password" in (statusRow ?? {})) &&
        !("gsp_username" in (statusRow ?? {})) &&
        !("client_secret" in (statusRow ?? {})),
      `body ${JSON.stringify(statusRpc.data)}`,
    );

    const outsiderStatusRpc = await rpc("eway_bill_credentials_status", {
      token: outsider.token,
      body: { _org: orgId },
    });
    check(
      "a non-member gets no rows from eway_bill_credentials_status()",
      outsiderStatusRpc.ok &&
        Array.isArray(outsiderStatusRpc.data) &&
        outsiderStatusRpc.data.length === 0,
      `body ${JSON.stringify(outsiderStatusRpc.data)}`,
    );
  }

  // --- N. e-Invoicing (SP-8) -------------------------------------------------
  console.log("\nN. e-Invoicing: generate/cancel permission gating, credential secrecy, isolation");
  {
    const salesManager = await makeUser("einvsales");
    const accountant = await makeUser("einvaccountant");
    const viewer = await makeUser("einvviewer");

    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: salesManager.id, role: "sales_manager" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: accountant.id, role: "accountant" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: viewer.id, role: "viewer" },
    });

    // Self-contained order -> confirm -> ship -> invoice lifecycle so this
    // section never depends on state left behind by an earlier one.
    const customer = await rest("POST", "customers", {
      token: admin.token,
      body: { org_id: orgId, name: `N Customer ${RUN_ID}`, state: "Maharashtra" },
    });
    const customerId = customer.data?.[0]?.id;
    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "e-Invoice Test WH", code: `EINV-WH-${RUN_ID}` },
    });
    const warehouseId = warehouse.data?.[0]?.id;
    const product = await rest("POST", "products", {
      token: admin.token,
      body: {
        org_id: orgId,
        sku: `EINV-SKU-${RUN_ID}`,
        name: "e-Invoice test product",
        hsn_code: "9999",
        selling_price: 100,
        tax_rate: 18,
      },
    });
    const productId = product.data?.[0]?.id;
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

    const soNumber = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    const so = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: soNumber.data,
        subtotal: 500,
        total_amount: 590,
      },
    });
    const soId = so.data?.[0]?.id;
    await rest("POST", "sales_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        sales_order_id: soId,
        product_id: productId,
        quantity: 5,
        unit_price: 100,
        tax_rate: 18,
      },
    });
    await rpc("confirm_sales_order", { token: admin.token, body: { _so_id: soId } });
    await rpc("ship_sales_order", { token: admin.token, body: { _so_id: soId } });
    const genInvoice = await rpc("generate_sales_invoice", {
      token: admin.token,
      body: { _so_id: soId },
    });
    check(
      "fixture: admin can generate the sales invoice this section tests against",
      genInvoice.ok,
      `status ${genInvoice.status}, body ${JSON.stringify(genInvoice.data)}`,
    );
    const invoiceId = genInvoice.data;

    const einvoicePayload = () => ({
      org_id: orgId,
      invoice_id: invoiceId,
      irn: `IRN${RUN_ID}`,
      ack_no: `ACK${RUN_ID}`,
      ack_date: new Date().toISOString(),
      qr_code: "test-qr-payload",
      request_payload: {},
      response_payload: {},
    });

    // A role without einvoices.generate (viewer) cannot record a generated IRN.
    const viewerGenerate = await rest("POST", "einvoices", {
      token: viewer.token,
      body: einvoicePayload(),
    });
    check(
      "viewer cannot record an e-Invoice (lacks einvoices.generate)",
      !viewerGenerate.ok,
      `status ${viewerGenerate.status}, body ${JSON.stringify(viewerGenerate.data)}`,
    );

    // sales_manager (has einvoices.generate) can.
    const smGenerate = await rest("POST", "einvoices", {
      token: salesManager.token,
      body: einvoicePayload(),
    });
    check(
      "sales_manager can record a generated e-Invoice",
      smGenerate.ok,
      `status ${smGenerate.status}, body ${JSON.stringify(smGenerate.data)}`,
    );
    const einvoiceId = smGenerate.data?.[0]?.id;

    // Only one ACTIVE IRN per invoice at a time.
    const duplicateGenerate = await rest("POST", "einvoices", {
      token: salesManager.token,
      body: einvoicePayload(),
    });
    check(
      "a second active e-Invoice for the same sales invoice is rejected",
      !duplicateGenerate.ok,
      `status ${duplicateGenerate.status}, body ${JSON.stringify(duplicateGenerate.data)}`,
    );

    // sales_manager has einvoices.generate but NOT einvoices.cancel.
    const smCancel = await rest("PATCH", "einvoices", {
      token: salesManager.token,
      query: `?id=eq.${einvoiceId}`,
      body: { status: "cancelled", cancelled_at: new Date().toISOString() },
    });
    const smCancelled = smCancel.ok && smCancel.data?.length > 0;
    check(
      "sales_manager cannot cancel an e-Invoice (lacks einvoices.cancel)",
      !smCancelled,
      `status ${smCancel.status}, body ${JSON.stringify(smCancel.data)}`,
    );

    // accountant (has einvoices.cancel) can.
    const acctCancel = await rest("PATCH", "einvoices", {
      token: accountant.token,
      query: `?id=eq.${einvoiceId}`,
      body: { status: "cancelled", cancelled_at: new Date().toISOString() },
    });
    check(
      "accountant can cancel an e-Invoice",
      acctCancel.ok && acctCancel.data?.length > 0,
      `status ${acctCancel.status}, body ${JSON.stringify(acctCancel.data)}`,
    );

    // Cancelling frees the invoice up for a fresh generation.
    const regenerate = await rest("POST", "einvoices", {
      token: salesManager.token,
      body: einvoicePayload(),
    });
    check(
      "a new e-Invoice can be generated after the prior one is cancelled",
      regenerate.ok,
      `status ${regenerate.status}, body ${JSON.stringify(regenerate.data)}`,
    );

    // No DELETE policy at all -- an IRN is a permanent legal record.
    const deleteAttempt = await rest("DELETE", "einvoices", {
      token: admin.token,
      query: `?id=eq.${einvoiceId}`,
    });
    const wasDeleted = deleteAttempt.ok && deleteAttempt.data?.length > 0;
    check(
      "an e-Invoice row cannot be deleted via the client API",
      !wasDeleted,
      `status ${deleteAttempt.status}, body ${JSON.stringify(deleteAttempt.data)}`,
    );

    // Cross-tenant isolation.
    const outsiderRead = await rest("GET", "einvoices", {
      token: outsider.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read another org's e-Invoices",
      outsiderRead.ok && Array.isArray(outsiderRead.data) && outsiderRead.data.length === 0,
      `body ${JSON.stringify(outsiderRead.data)}`,
    );

    // --- Credentials: no client SELECT path for anyone, writes gated by settings.manage ---
    // return=minimal: same no-SELECT-policy reasoning as eway_bill_credentials above.
    const credInsert = await rest("POST", "einvoice_credentials", {
      token: admin.token,
      extraHeaders: { Prefer: "return=minimal" },
      body: {
        org_id: orgId,
        gsp_provider: "TestGSP",
        auth_url: "https://example.test/auth",
        generate_url: "https://example.test/generate",
        cancel_url: "https://example.test/cancel",
        gsp_username: "test-user",
        gsp_password: "super-secret",
      },
    });
    check(
      "admin (settings.manage) can save e-Invoicing credentials",
      credInsert.ok,
      `status ${credInsert.status}, body ${JSON.stringify(credInsert.data)}`,
    );

    const acctCredUpdate = await rest("PATCH", "einvoice_credentials", {
      token: accountant.token,
      query: `?org_id=eq.${orgId}`,
      body: { gsp_provider: "Hijacked" },
    });
    const acctTampered = acctCredUpdate.ok && acctCredUpdate.data?.length > 0;
    check(
      "accountant (lacks settings.manage) cannot update e-Invoicing credentials",
      !acctTampered,
      `status ${acctCredUpdate.status}, body ${JSON.stringify(acctCredUpdate.data)}`,
    );

    const adminCredRead = await rest("GET", "einvoice_credentials", {
      token: admin.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "even an org admin cannot SELECT e-Invoicing credentials directly (service_role only)",
      adminCredRead.ok && Array.isArray(adminCredRead.data) && adminCredRead.data.length === 0,
      `status ${adminCredRead.status}, body ${JSON.stringify(adminCredRead.data)}`,
    );

    const statusRpc = await rpc("einvoice_credentials_status", {
      token: viewer.token,
      body: { _org: orgId },
    });
    const statusRow = statusRpc.data?.[0];
    check(
      "einvoice_credentials_status() exposes only non-secret metadata to org members",
      statusRpc.ok &&
        statusRow?.gsp_provider === "TestGSP" &&
        !("gsp_password" in (statusRow ?? {})) &&
        !("gsp_username" in (statusRow ?? {})) &&
        !("client_secret" in (statusRow ?? {})),
      `body ${JSON.stringify(statusRpc.data)}`,
    );

    const outsiderStatusRpc2 = await rpc("einvoice_credentials_status", {
      token: outsider.token,
      body: { _org: orgId },
    });
    check(
      "a non-member gets no rows from einvoice_credentials_status()",
      outsiderStatusRpc2.ok &&
        Array.isArray(outsiderStatusRpc2.data) &&
        outsiderStatusRpc2.data.length === 0,
      `body ${JSON.stringify(outsiderStatusRpc2.data)}`,
    );
  }

  // --- O. Stock Transfers (SP-9) --------------------------------------------
  console.log(
    "\nO. Stock transfers: workflow, on_hand/in_transit accounting, permission gating, isolation",
  );
  {
    const inventoryManager = await makeUser("sttinv");
    const warehouseOp = await makeUser("sttwhop");
    const viewer = await makeUser("sttviewer");

    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: inventoryManager.id, role: "inventory_manager" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: warehouseOp.id, role: "warehouse_operator" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: viewer.id, role: "viewer" },
    });

    const sourceWh = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "Transfer Source WH", code: `STT-SRC-${RUN_ID}` },
    });
    const sourceWhId = sourceWh.data?.[0]?.id;
    const destWh = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "Transfer Dest WH", code: `STT-DST-${RUN_ID}` },
    });
    const destWhId = destWh.data?.[0]?.id;
    const product = await rest("POST", "products", {
      token: admin.token,
      body: { org_id: orgId, sku: `STT-SKU-${RUN_ID}`, name: "Stock transfer test product" },
    });
    const productId = product.data?.[0]?.id;

    // Only 5 on hand at the source -- used below to prove shipping is
    // blocked before there's enough stock, then allowed after topping up.
    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: sourceWhId,
        type: "inbound",
        quantity: 5,
      },
    });

    const viewerCreate = await rest("POST", "stock_transfers", {
      token: viewer.token,
      body: {
        org_id: orgId,
        transfer_number: `ST-VIEWER-${RUN_ID}`,
        source_warehouse_id: sourceWhId,
        destination_warehouse_id: destWhId,
      },
    });
    check(
      "viewer cannot create a stock transfer (lacks stock_transfers.edit)",
      !viewerCreate.ok,
      `status ${viewerCreate.status}`,
    );

    const transfer = await rest("POST", "stock_transfers", {
      token: inventoryManager.token,
      body: {
        org_id: orgId,
        transfer_number: `ST-${RUN_ID}`,
        source_warehouse_id: sourceWhId,
        destination_warehouse_id: destWhId,
      },
    });
    check(
      "inventory_manager can create a draft stock transfer",
      transfer.ok,
      `status ${transfer.status}, body ${JSON.stringify(transfer.data)}`,
    );
    const transferId = transfer.data?.[0]?.id;

    const item = await rest("POST", "stock_transfer_items", {
      token: inventoryManager.token,
      body: { org_id: orgId, stock_transfer_id: transferId, product_id: productId, quantity: 10 },
    });
    check("inventory_manager can add a line item", item.ok, `status ${item.status}`);
    const itemId = item.data?.[0]?.id;

    const whopRequest = await rest("PATCH", "stock_transfers", {
      token: warehouseOp.token,
      query: `?id=eq.${transferId}`,
      body: { status: "requested" },
    });
    const whopRequested = whopRequest.ok && whopRequest.data?.length > 0;
    check(
      "warehouse_operator cannot submit a transfer for approval (lacks stock_transfers.edit)",
      !whopRequested,
      `status ${whopRequest.status}, body ${JSON.stringify(whopRequest.data)}`,
    );

    await rest("PATCH", "stock_transfers", {
      token: inventoryManager.token,
      query: `?id=eq.${transferId}`,
      body: { status: "requested" },
    });
    await rest("PATCH", "stock_transfers", {
      token: inventoryManager.token,
      query: `?id=eq.${transferId}`,
      body: { status: "approved" },
    });

    // Status is now 'approved', so this failure is genuinely about
    // permission, not about the transfer being in the wrong state.
    const whopApprove = await rpc("ship_stock_transfer", {
      token: warehouseOp.token,
      body: { _transfer_id: transferId },
    });
    check(
      "warehouse_operator cannot ship an approved transfer (lacks stock_transfers.approve)",
      !whopApprove.ok,
      `status ${whopApprove.status}, body ${JSON.stringify(whopApprove.data)}`,
    );

    // Only 5 on hand, the line asks for 10 -- shipping must be blocked
    // entirely (no partial stock movement).
    const shortShip = await rpc("ship_stock_transfer", {
      token: inventoryManager.token,
      body: { _transfer_id: transferId },
    });
    check(
      "shipping is blocked when the source warehouse doesn't have enough stock",
      !shortShip.ok,
      `expected failure, got status ${shortShip.status}, body ${JSON.stringify(shortShip.data)}`,
    );

    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: sourceWhId,
        type: "inbound",
        quantity: 10,
      },
    });

    const ship = await rpc("ship_stock_transfer", {
      token: inventoryManager.token,
      body: { _transfer_id: transferId },
    });
    check(
      "inventory_manager can ship once there's enough stock",
      ship.ok,
      `status ${ship.status}, body ${JSON.stringify(ship.data)}`,
    );

    const sourceLevel = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${sourceWhId}&select=quantity`,
    });
    const destLevelAfterShip = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${destWhId}&select=in_transit,quantity`,
    });
    check(
      "shipping decrements on_hand at the source",
      Number(sourceLevel.data?.[0]?.quantity) === 5,
      `body ${JSON.stringify(sourceLevel.data)}`,
    );
    check(
      "shipping increments in_transit at the destination without touching its on_hand",
      Number(destLevelAfterShip.data?.[0]?.in_transit) === 10 &&
        Number(destLevelAfterShip.data?.[0]?.quantity ?? 0) === 0,
      `body ${JSON.stringify(destLevelAfterShip.data)}`,
    );

    const transferAfterShip = await rest("GET", "stock_transfers", {
      token: admin.token,
      query: `?id=eq.${transferId}&select=status`,
    });
    check(
      "transfer status is in_transit after shipping",
      transferAfterShip.data?.[0]?.status === "in_transit",
      `body ${JSON.stringify(transferAfterShip.data)}`,
    );

    const viewerReceive = await rpc("receive_stock_transfer_item", {
      token: viewer.token,
      body: { _item_id: itemId, _quantity: 6, _damaged_quantity: 0 },
    });
    check(
      "viewer cannot receive a stock transfer (lacks stock_transfers.receive)",
      !viewerReceive.ok,
      `status ${viewerReceive.status}`,
    );

    // Partial receipt: 6 good + 1 damaged out of 10 shipped.
    const partialReceive = await rpc("receive_stock_transfer_item", {
      token: warehouseOp.token,
      body: { _item_id: itemId, _quantity: 6, _damaged_quantity: 1 },
    });
    check(
      "warehouse_operator can receive a partial, split good/damaged quantity",
      partialReceive.ok,
      `status ${partialReceive.status}, body ${JSON.stringify(partialReceive.data)}`,
    );

    const destLevelAfterPartial = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${destWhId}&select=quantity,damaged,in_transit`,
    });
    check(
      "a partial receipt increments on_hand and damaged, decrementing in_transit by the same total",
      Number(destLevelAfterPartial.data?.[0]?.quantity) === 6 &&
        Number(destLevelAfterPartial.data?.[0]?.damaged) === 1 &&
        Number(destLevelAfterPartial.data?.[0]?.in_transit) === 3,
      `body ${JSON.stringify(destLevelAfterPartial.data)}`,
    );

    const transferAfterPartial = await rest("GET", "stock_transfers", {
      token: admin.token,
      query: `?id=eq.${transferId}&select=status`,
    });
    check(
      "the transfer stays in_transit while a line is only partially accounted for",
      transferAfterPartial.data?.[0]?.status === "in_transit",
      `body ${JSON.stringify(transferAfterPartial.data)}`,
    );

    const finalReceive = await rpc("receive_stock_transfer_item", {
      token: warehouseOp.token,
      body: { _item_id: itemId, _quantity: 3, _damaged_quantity: 0 },
    });
    check(
      "warehouse_operator can receive the remainder",
      finalReceive.ok,
      `status ${finalReceive.status}, body ${JSON.stringify(finalReceive.data)}`,
    );

    const transferAfterFull = await rest("GET", "stock_transfers", {
      token: admin.token,
      query: `?id=eq.${transferId}&select=status`,
    });
    check(
      "the transfer moves to received once every line is fully accounted for",
      transferAfterFull.data?.[0]?.status === "received",
      `body ${JSON.stringify(transferAfterFull.data)}`,
    );

    const whopComplete = await rest("PATCH", "stock_transfers", {
      token: viewer.token,
      query: `?id=eq.${transferId}`,
      body: { status: "completed", completed_at: new Date().toISOString() },
    });
    const viewerCompleted = whopComplete.ok && whopComplete.data?.length > 0;
    check(
      "viewer cannot complete a received transfer",
      !viewerCompleted,
      `status ${whopComplete.status}`,
    );

    const complete = await rest("PATCH", "stock_transfers", {
      token: warehouseOp.token,
      query: `?id=eq.${transferId}`,
      body: { status: "completed", completed_at: new Date().toISOString() },
    });
    check(
      "warehouse_operator (has stock_transfers.receive) can complete a received transfer",
      complete.ok && complete.data?.length > 0,
      `status ${complete.status}, body ${JSON.stringify(complete.data)}`,
    );

    const cancelDone = await rpc("cancel_stock_transfer", {
      token: inventoryManager.token,
      body: { _transfer_id: transferId },
    });
    check(
      "a completed transfer can no longer be cancelled",
      !cancelDone.ok,
      `expected failure, got status ${cancelDone.status}`,
    );

    // --- Cancellation reverses only the still-outstanding in-transit qty ---
    const transfer2 = await rest("POST", "stock_transfers", {
      token: inventoryManager.token,
      body: {
        org_id: orgId,
        transfer_number: `ST2-${RUN_ID}`,
        source_warehouse_id: sourceWhId,
        destination_warehouse_id: destWhId,
      },
    });
    const transfer2Id = transfer2.data?.[0]?.id;
    const item2 = await rest("POST", "stock_transfer_items", {
      token: inventoryManager.token,
      body: {
        org_id: orgId,
        stock_transfer_id: transfer2Id,
        product_id: productId,
        quantity: 4,
      },
    });
    const item2Id = item2.data?.[0]?.id;
    await rest("PATCH", "stock_transfers", {
      token: inventoryManager.token,
      query: `?id=eq.${transfer2Id}`,
      body: { status: "requested" },
    });
    await rest("PATCH", "stock_transfers", {
      token: inventoryManager.token,
      query: `?id=eq.${transfer2Id}`,
      body: { status: "approved" },
    });
    await rpc("ship_stock_transfer", {
      token: inventoryManager.token,
      body: { _transfer_id: transfer2Id },
    });
    // Receive half before cancelling -- the received half must NOT be
    // reversed, only the outstanding 2 units still in transit.
    await rpc("receive_stock_transfer_item", {
      token: warehouseOp.token,
      body: { _item_id: item2Id, _quantity: 2, _damaged_quantity: 0 },
    });

    const sourceBeforeCancel = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${sourceWhId}&select=quantity`,
    });

    const cancel2 = await rpc("cancel_stock_transfer", {
      token: inventoryManager.token,
      body: { _transfer_id: transfer2Id },
    });
    check(
      "inventory_manager can cancel an in-transit transfer",
      cancel2.ok,
      `status ${cancel2.status}, body ${JSON.stringify(cancel2.data)}`,
    );

    const sourceAfterCancel = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${sourceWhId}&select=quantity`,
    });
    check(
      "cancelling restores only the outstanding (unreceived) quantity to the source",
      Number(sourceAfterCancel.data?.[0]?.quantity) ===
        Number(sourceBeforeCancel.data?.[0]?.quantity) + 2,
      `before ${JSON.stringify(sourceBeforeCancel.data)}, after ${JSON.stringify(sourceAfterCancel.data)}`,
    );

    const destAfterCancel = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${destWhId}&select=in_transit`,
    });
    check(
      "cancelling clears the outstanding in_transit at the destination",
      Number(destAfterCancel.data?.[0]?.in_transit) === 0,
      `body ${JSON.stringify(destAfterCancel.data)}`,
    );

    const transfer2AfterCancel = await rest("GET", "stock_transfers", {
      token: admin.token,
      query: `?id=eq.${transfer2Id}&select=status`,
    });
    check(
      "a cancelled transfer's status is cancelled",
      transfer2AfterCancel.data?.[0]?.status === "cancelled",
      `body ${JSON.stringify(transfer2AfterCancel.data)}`,
    );

    // A draft transfer's cancellation is a pure status flip -- nothing to
    // reverse since no stock has moved yet.
    const draftTransfer = await rest("POST", "stock_transfers", {
      token: inventoryManager.token,
      body: {
        org_id: orgId,
        transfer_number: `ST3-${RUN_ID}`,
        source_warehouse_id: sourceWhId,
        destination_warehouse_id: destWhId,
      },
    });
    const draftCancel = await rpc("cancel_stock_transfer", {
      token: inventoryManager.token,
      body: { _transfer_id: draftTransfer.data?.[0]?.id },
    });
    check(
      "a draft transfer can be cancelled with no stock to reverse",
      draftCancel.ok,
      `status ${draftCancel.status}, body ${JSON.stringify(draftCancel.data)}`,
    );

    // No DELETE policy check: only stock_transfers.delete holders (not
    // warehouse_operator) can delete a transfer at all.
    const whopDelete = await rest("DELETE", "stock_transfers", {
      token: warehouseOp.token,
      query: `?id=eq.${draftTransfer.data?.[0]?.id}`,
    });
    const whopDeleted = whopDelete.ok && whopDelete.data?.length > 0;
    check(
      "warehouse_operator cannot delete a stock transfer (lacks stock_transfers.delete)",
      !whopDeleted,
      `status ${whopDelete.status}, body ${JSON.stringify(whopDelete.data)}`,
    );

    // Cross-tenant isolation.
    const outsiderTransferRead = await rest("GET", "stock_transfers", {
      token: outsider.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read another org's stock transfers",
      outsiderTransferRead.ok &&
        Array.isArray(outsiderTransferRead.data) &&
        outsiderTransferRead.data.length === 0,
      `body ${JSON.stringify(outsiderTransferRead.data)}`,
    );

    const outsiderItemRead = await rest("GET", "stock_transfer_items", {
      token: outsider.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read another org's stock transfer items",
      outsiderItemRead.ok &&
        Array.isArray(outsiderItemRead.data) &&
        outsiderItemRead.data.length === 0,
      `body ${JSON.stringify(outsiderItemRead.data)}`,
    );

    const outsiderShip = await rpc("ship_stock_transfer", {
      token: outsider.token,
      body: { _transfer_id: transferId },
    });
    check(
      "a non-member cannot ship another org's stock transfer",
      !outsiderShip.ok,
      `status ${outsiderShip.status}`,
    );
  }

  // --- P. Sales Returns / RMA (SP-11) ---------------------------------------
  console.log(
    "\nP. Sales returns: creation gating, restock/damage/credit-only, credit notes, isolation",
  );
  {
    const salesManager = await makeUser("srsales");
    const accountant = await makeUser("sraccountant");
    const viewer = await makeUser("srviewer");

    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: salesManager.id, role: "sales_manager" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: accountant.id, role: "accountant" },
    });
    await rest("POST", "organization_members", {
      token: owner.token,
      body: { org_id: orgId, user_id: viewer.id, role: "viewer" },
    });

    const customer = await rest("POST", "customers", {
      token: admin.token,
      body: { org_id: orgId, name: "Sales Return Test Customer" },
    });
    const customerId = customer.data?.[0]?.id;
    const warehouse = await rest("POST", "warehouses", {
      token: admin.token,
      body: { org_id: orgId, name: "Sales Return Test WH", code: `SR-WH-${RUN_ID}` },
    });
    const warehouseId = warehouse.data?.[0]?.id;
    const product = await rest("POST", "products", {
      token: admin.token,
      body: {
        org_id: orgId,
        sku: `SR-SKU-${RUN_ID}`,
        name: "Sales return test product",
        selling_price: 100,
        tax_rate: 18,
      },
    });
    const productId = product.data?.[0]?.id;
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

    // Shipped SO with an invoice generated -- the fixture every "happy
    // path" check below runs against.
    const soNumber = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    const so = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: soNumber.data,
        subtotal: 1000,
        total_amount: 1180,
      },
    });
    const soId = so.data?.[0]?.id;
    await rest("POST", "sales_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        sales_order_id: soId,
        product_id: productId,
        quantity: 10,
        unit_price: 100,
        tax_rate: 18,
      },
    });
    await rpc("confirm_sales_order", { token: admin.token, body: { _so_id: soId } });
    await rpc("ship_sales_order", { token: admin.token, body: { _so_id: soId } });
    const genInvoice = await rpc("generate_sales_invoice", {
      token: admin.token,
      body: { _so_id: soId },
    });
    const invoiceId = genInvoice.data;

    // A still-draft SO, and a second shipped SO with no invoice generated
    // -- fixtures for the two creation/approval guards below.
    const draftSoNumber = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    const draftSo = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: draftSoNumber.data,
        subtotal: 100,
        total_amount: 118,
      },
    });
    const draftSoId = draftSo.data?.[0]?.id;

    const noInvoiceSoNumber = await rpc("next_sales_order_number", {
      token: admin.token,
      body: { _org_id: orgId },
    });
    const noInvoiceSo = await rest("POST", "sales_orders", {
      token: admin.token,
      body: {
        org_id: orgId,
        customer_id: customerId,
        warehouse_id: warehouseId,
        so_number: noInvoiceSoNumber.data,
        subtotal: 100,
        total_amount: 118,
      },
    });
    const noInvoiceSoId = noInvoiceSo.data?.[0]?.id;
    await rest("POST", "sales_order_items", {
      token: admin.token,
      body: {
        org_id: orgId,
        sales_order_id: noInvoiceSoId,
        product_id: productId,
        quantity: 1,
        unit_price: 100,
        tax_rate: 18,
      },
    });
    // The first SO already shipped (and thereby consumed) all 10 units
    // stocked above -- top up before confirming this one, or confirm would
    // fail for insufficient stock rather than the order actually shipping.
    await rest("POST", "stock_movements", {
      token: admin.token,
      body: {
        org_id: orgId,
        product_id: productId,
        warehouse_id: warehouseId,
        type: "inbound",
        quantity: 1,
      },
    });
    const noInvoiceConfirm = await rpc("confirm_sales_order", {
      token: admin.token,
      body: { _so_id: noInvoiceSoId },
    });
    const noInvoiceShip = await rpc("ship_sales_order", {
      token: admin.token,
      body: { _so_id: noInvoiceSoId },
    });
    check(
      "fixture: the no-invoice sales order actually ships",
      noInvoiceConfirm.ok && noInvoiceShip.ok,
      `confirm status ${noInvoiceConfirm.status}, ship status ${noInvoiceShip.status}`,
    );

    const viewerCreate = await rest("POST", "sales_returns", {
      token: viewer.token,
      body: { org_id: orgId, sales_order_id: soId, return_number: `RMA-VIEWER-${RUN_ID}` },
    });
    check(
      "viewer cannot create a sales return (lacks sales_returns.create)",
      !viewerCreate.ok,
      `status ${viewerCreate.status}`,
    );

    const draftSoReturn = await rest("POST", "sales_returns", {
      token: salesManager.token,
      body: { org_id: orgId, sales_order_id: draftSoId, return_number: `RMA-DRAFT-${RUN_ID}` },
    });
    check(
      "a return cannot be created against a draft (unshipped) sales order",
      !draftSoReturn.ok,
      `expected failure, got status ${draftSoReturn.status}, body ${JSON.stringify(draftSoReturn.data)}`,
    );

    const outsiderCreate = await rest("POST", "sales_returns", {
      token: outsider.token,
      body: { org_id: orgId, sales_order_id: soId, return_number: `RMA-OUT-${RUN_ID}` },
    });
    check(
      "a non-member cannot create a sales return against another org's sales order",
      !outsiderCreate.ok,
      `expected failure, got status ${outsiderCreate.status}`,
    );

    // R1: mixed disposition -- 3 restocked good, 2 restocked damaged, 1
    // credit-only, out of 10 sold.
    const r1 = await rest("POST", "sales_returns", {
      token: salesManager.token,
      body: { org_id: orgId, sales_order_id: soId, return_number: `RMA1-${RUN_ID}` },
    });
    check(
      "sales_manager can create a draft return against a shipped order",
      r1.ok,
      `status ${r1.status}, body ${JSON.stringify(r1.data)}`,
    );
    const r1Id = r1.data?.[0]?.id;
    check(
      "the return's sales_invoice_id is auto-resolved from the sales order",
      r1.data?.[0]?.sales_invoice_id === invoiceId,
      `body ${JSON.stringify(r1.data)}`,
    );

    await rest("POST", "sales_return_items", {
      token: salesManager.token,
      body: {
        org_id: orgId,
        sales_return_id: r1Id,
        product_id: productId,
        quantity: 3,
        unit_price: 100,
        reason: "wrong_item",
        restock: true,
        is_damaged: false,
      },
    });
    await rest("POST", "sales_return_items", {
      token: salesManager.token,
      body: {
        org_id: orgId,
        sales_return_id: r1Id,
        product_id: productId,
        quantity: 2,
        unit_price: 100,
        reason: "damaged",
        restock: true,
        is_damaged: true,
      },
    });
    await rest("POST", "sales_return_items", {
      token: salesManager.token,
      body: {
        org_id: orgId,
        sales_return_id: r1Id,
        product_id: productId,
        quantity: 1,
        unit_price: 100,
        reason: "changed_mind",
        restock: false,
        is_damaged: false,
      },
    });

    const viewerApprove = await rpc("approve_sales_return", {
      token: viewer.token,
      body: { _return_id: r1Id },
    });
    check(
      "viewer cannot approve a sales return (lacks sales_returns.approve)",
      !viewerApprove.ok,
      `status ${viewerApprove.status}`,
    );

    const onHandBefore = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity,damaged`,
    });

    const approveR1 = await rpc("approve_sales_return", {
      token: accountant.token,
      body: { _return_id: r1Id },
    });
    check(
      "accountant (has sales_returns.approve) can approve the return",
      approveR1.ok,
      `status ${approveR1.status}, body ${JSON.stringify(approveR1.data)}`,
    );

    const onHandAfter = await rest("GET", "stock_levels", {
      token: admin.token,
      query: `?product_id=eq.${productId}&warehouse_id=eq.${warehouseId}&select=quantity,damaged`,
    });
    check(
      "approving posts the good-restock line to on_hand and the damaged line to damaged",
      Number(onHandAfter.data?.[0]?.quantity) === Number(onHandBefore.data?.[0]?.quantity) + 3 &&
        Number(onHandAfter.data?.[0]?.damaged) === Number(onHandBefore.data?.[0]?.damaged) + 2,
      `before ${JSON.stringify(onHandBefore.data)}, after ${JSON.stringify(onHandAfter.data)}`,
    );

    const r1AfterApprove = await rest("GET", "sales_returns", {
      token: admin.token,
      query: `?id=eq.${r1Id}&select=status,credit_note_id`,
    });
    const creditNoteId = r1AfterApprove.data?.[0]?.credit_note_id;
    check(
      "the return moves to approved and records the credit note it issued",
      r1AfterApprove.data?.[0]?.status === "approved" && !!creditNoteId,
      `body ${JSON.stringify(r1AfterApprove.data)}`,
    );

    const creditNote = await rest("GET", "credit_notes", {
      token: admin.token,
      query: `?id=eq.${creditNoteId}&select=subtotal,is_full,sales_return_id,sales_invoice_id`,
    });
    check(
      "the credit note covers all 6 returned units (credit-only line included) and links back to the return",
      Number(creditNote.data?.[0]?.subtotal) === 600 &&
        creditNote.data?.[0]?.is_full === false &&
        creditNote.data?.[0]?.sales_return_id === r1Id &&
        creditNote.data?.[0]?.sales_invoice_id === invoiceId,
      `body ${JSON.stringify(creditNote.data)}`,
    );

    const reapprove = await rpc("approve_sales_return", {
      token: accountant.token,
      body: { _return_id: r1Id },
    });
    check(
      "an already-approved return cannot be approved again",
      !reapprove.ok,
      `expected failure, got status ${reapprove.status}`,
    );

    // R2: 5 more of the same product -- combined with R1's already-approved
    // 6, that's 11 against only 10 sold, so approval must be blocked.
    const r2 = await rest("POST", "sales_returns", {
      token: salesManager.token,
      body: { org_id: orgId, sales_order_id: soId, return_number: `RMA2-${RUN_ID}` },
    });
    const r2Id = r2.data?.[0]?.id;
    await rest("POST", "sales_return_items", {
      token: salesManager.token,
      body: {
        org_id: orgId,
        sales_return_id: r2Id,
        product_id: productId,
        quantity: 5,
        unit_price: 100,
        reason: "other",
        restock: true,
        is_damaged: false,
      },
    });
    const overReturn = await rpc("approve_sales_return", {
      token: salesManager.token,
      body: { _return_id: r2Id },
    });
    check(
      "approval is blocked once the total returned would exceed what was sold",
      !overReturn.ok,
      `expected failure, got status ${overReturn.status}, body ${JSON.stringify(overReturn.data)}`,
    );

    const emptyReturn = await rest("POST", "sales_returns", {
      token: salesManager.token,
      body: { org_id: orgId, sales_order_id: soId, return_number: `RMA-EMPTY-${RUN_ID}` },
    });
    const emptyApprove = await rpc("approve_sales_return", {
      token: salesManager.token,
      body: { _return_id: emptyReturn.data?.[0]?.id },
    });
    check(
      "a return with no line items cannot be approved",
      !emptyApprove.ok,
      `expected failure, got status ${emptyApprove.status}`,
    );

    const noInvoiceReturn = await rest("POST", "sales_returns", {
      token: salesManager.token,
      body: { org_id: orgId, sales_order_id: noInvoiceSoId, return_number: `RMA-NOINV-${RUN_ID}` },
    });
    check(
      "fixture: a draft return can be created against the shipped no-invoice order",
      noInvoiceReturn.ok,
      `status ${noInvoiceReturn.status}, body ${JSON.stringify(noInvoiceReturn.data)}`,
    );
    const noInvoiceReturnId = noInvoiceReturn.data?.[0]?.id;
    await rest("POST", "sales_return_items", {
      token: salesManager.token,
      body: {
        org_id: orgId,
        sales_return_id: noInvoiceReturnId,
        product_id: productId,
        quantity: 1,
        unit_price: 100,
        reason: "other",
        restock: false,
      },
    });
    const noInvoiceApprove = await rpc("approve_sales_return", {
      token: salesManager.token,
      body: { _return_id: noInvoiceReturnId },
    });
    check(
      "a return cannot be approved before an invoice exists for its sales order",
      !noInvoiceApprove.ok && /invoice/i.test(noInvoiceApprove.data?.message ?? ""),
      `expected an invoice-related failure, got status ${noInvoiceApprove.status}, body ${JSON.stringify(noInvoiceApprove.data)}`,
    );

    const viewerComplete = await rest("PATCH", "sales_returns", {
      token: viewer.token,
      query: `?id=eq.${r1Id}`,
      body: { status: "completed", completed_at: new Date().toISOString() },
    });
    const viewerCompleted = viewerComplete.ok && viewerComplete.data?.length > 0;
    check(
      "viewer cannot complete an approved return (lacks sales_returns.approve)",
      !viewerCompleted,
      `status ${viewerComplete.status}`,
    );

    const complete = await rest("PATCH", "sales_returns", {
      token: salesManager.token,
      query: `?id=eq.${r1Id}`,
      body: { status: "completed", completed_at: new Date().toISOString() },
    });
    check(
      "sales_manager can mark an approved return completed",
      complete.ok && complete.data?.length > 0,
      `status ${complete.status}, body ${JSON.stringify(complete.data)}`,
    );

    const cancelApproved = await rest("PATCH", "sales_returns", {
      token: salesManager.token,
      query: `?id=eq.${r2Id}`,
      body: { status: "cancelled", cancelled_at: new Date().toISOString() },
    });
    // r2 is still a draft (its approval was blocked above), so this
    // exercises the ordinary cancel path, not the "can't cancel a
    // non-draft return" guard -- that guard has no draft-only fixture left
    // to prove it against without another return, so it's covered
    // structurally by the trigger's OLD.status check plus the r1
    // reapprove-after-approved check above already proving OLD.status is
    // enforced on this table.
    const accountantCancel = await rest("PATCH", "sales_returns", {
      token: accountant.token,
      query: `?id=eq.${emptyReturn.data?.[0]?.id}`,
      body: { status: "cancelled", cancelled_at: new Date().toISOString() },
    });
    const accountantCancelled = accountantCancel.ok && accountantCancel.data?.length > 0;
    check(
      "accountant cannot cancel a draft return (lacks sales_returns.cancel)",
      !accountantCancelled,
      `status ${accountantCancel.status}`,
    );
    check(
      "sales_manager can cancel a draft return",
      cancelApproved.ok && cancelApproved.data?.length > 0,
      `status ${cancelApproved.status}, body ${JSON.stringify(cancelApproved.data)}`,
    );

    const accountantDelete = await rest("DELETE", "sales_returns", {
      token: accountant.token,
      query: `?id=eq.${noInvoiceReturnId}`,
    });
    const accountantDeleted = accountantDelete.ok && accountantDelete.data?.length > 0;
    check(
      "accountant cannot delete a draft return (lacks sales_returns.delete)",
      !accountantDeleted,
      `status ${accountantDelete.status}`,
    );
    const smDelete = await rest("DELETE", "sales_returns", {
      token: salesManager.token,
      query: `?id=eq.${noInvoiceReturnId}`,
    });
    check(
      "sales_manager can delete a draft return",
      smDelete.ok && smDelete.data?.length > 0,
      `status ${smDelete.status}, body ${JSON.stringify(smDelete.data)}`,
    );

    // Cross-tenant isolation.
    const outsiderReturnRead = await rest("GET", "sales_returns", {
      token: outsider.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read another org's sales returns",
      outsiderReturnRead.ok &&
        Array.isArray(outsiderReturnRead.data) &&
        outsiderReturnRead.data.length === 0,
      `body ${JSON.stringify(outsiderReturnRead.data)}`,
    );

    const outsiderItemRead = await rest("GET", "sales_return_items", {
      token: outsider.token,
      query: `?org_id=eq.${orgId}`,
    });
    check(
      "a non-member cannot read another org's sales return items",
      outsiderItemRead.ok &&
        Array.isArray(outsiderItemRead.data) &&
        outsiderItemRead.data.length === 0,
      `body ${JSON.stringify(outsiderItemRead.data)}`,
    );

    const outsiderApprove = await rpc("approve_sales_return", {
      token: outsider.token,
      body: { _return_id: r1Id },
    });
    check(
      "a non-member cannot approve another org's sales return",
      !outsiderApprove.ok,
      `status ${outsiderApprove.status}`,
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
