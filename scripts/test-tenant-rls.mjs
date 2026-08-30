#!/usr/bin/env node
// Integration test suite for the multi-tenant RLS hardening
// (supabase/migrations/20260830130000_harden_tenant_rls.sql).
//
// Exercises the live Supabase project over its REST/Auth API — no
// @supabase/supabase-js needed, just Node's built-in fetch, so it runs
// with zero `npm install`.
//
// WHAT THIS CREATES: 4 throwaway auth users (emails tagged
// rls-test-<run>-*@test.stockpilot.invalid), 1 organization, and a
// handful of rows under it. Auth users cannot be deleted with the
// anon/publishable key, so repeated runs accumulate test accounts in
// your project. Two ways to clean up:
//   - export SUPABASE_SERVICE_ROLE_KEY=... before running, and this
//     script will delete everything it created at the end (pass or fail).
//   - or periodically remove users matching "rls-test-" from the
//     Supabase dashboard yourself.
//
// This performs real writes against your live project. Do not run it
// against a database you care about without SUPABASE_SERVICE_ROLE_KEY
// set for cleanup, or without being ready to hand-remove the test rows.
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

async function rest(method, table, { token, body, query = "", extraHeaders = {} } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: token ? ANON_KEY : SERVICE_KEY ?? ANON_KEY,
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

async function makeUser(tag) {
  const email = `rls-test-${RUN_ID}-${tag}@test.stockpilot.invalid`;
  const signup = await signUp(email, PASSWORD);
  if (!signup.ok) {
    throw new Error(`sign-up failed for ${email}: ${JSON.stringify(signup.data)}`);
  }
  let token = signup.data.access_token;
  let userId = signup.data.user?.id ?? signup.data.id;
  if (!token) {
    // Project requires email confirmation before a session is issued.
    const signin = await signIn(email, PASSWORD);
    if (!signin.ok || !signin.data.access_token) {
      throw new Error(
        `Project appears to require email confirmation, so ${email} has no session yet. ` +
          `This suite needs auto-confirmed sign-ups (Supabase Auth setting) to proceed. ` +
          `Raw response: ${JSON.stringify(signin.data)}`,
      );
    }
    token = signin.data.access_token;
    userId = signin.data.user?.id;
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

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

main()
  .then(async (failed) => {
    await cleanup();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("\nSuite errored out:", err.message);
    await cleanup();
    process.exit(1);
  });
