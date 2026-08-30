#!/usr/bin/env node
// One-off diagnostic: reproduces the exact onboarding.tsx "Create
// workspace" flow (insert org -> read it back -> insert warehouse)
// against the live Supabase project, and prints the raw response/error
// for each step. This exists to answer "what does Create workspace
// actually fail with" without needing to reproduce it through the
// browser UI.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (to create a pre-confirmed test
// user via the Admin API, same as scripts/test-tenant-rls.mjs) — this
// project requires email confirmation, so a plain signUp() here would
// never get a usable session.
//
// Cleans up the test user/org it creates at the end regardless of
// outcome. Meant to be run via the "Diagnose onboarding flow" GitHub
// Actions workflow (workflow_dispatch) so its output can be read
// straight from the job logs.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/diagnose-onboarding.mjs

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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (checked .env and process.env).");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY. This project requires email confirmation, so " +
      "this script needs the Admin API to create a pre-confirmed test user.",
  );
  process.exit(1);
}

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EMAIL = `diagnose-onboarding-${RUN_ID}@test.stockpilot.invalid`;
const PASSWORD = `Test!${RUN_ID}Aa1`;

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  );
}

async function rest(method, table, { token, body, query = "" } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
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

let userId = null;
let orgId = null;

async function cleanup() {
  console.log("\n--- Cleanup ---");
  if (orgId) {
    const del = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    console.log(`Deleted organization ${orgId}: ${del.status}`);
  }
  if (userId) {
    const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    console.log(`Deleted test user ${userId}: ${del.status}`);
  }
}

async function main() {
  console.log(`Diagnosing onboarding flow against ${SUPABASE_URL}`);
  console.log(`Test user: ${EMAIL}\n`);

  console.log("--- 1. Create pre-confirmed test user (Admin API) ---");
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const createData = await createRes.json().catch(() => ({}));
  console.log(`status ${createRes.status}`);
  if (!createRes.ok) {
    console.error("Could not create test user:", JSON.stringify(createData));
    process.exit(1);
  }
  userId = createData.id ?? createData.user?.id;
  console.log(`Created user ${userId}\n`);

  console.log("--- 2. Sign in as that user ---");
  const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const signinData = await signinRes.json().catch(() => ({}));
  console.log(`status ${signinRes.status}`);
  if (!signinRes.ok || !signinData.access_token) {
    console.error("Could not sign in:", JSON.stringify(signinData));
    await cleanup();
    process.exit(1);
  }
  const token = signinData.access_token;
  console.log("Signed in, got access token\n");

  console.log("--- 3. Insert organization (exact onboarding.tsx shape) ---");
  const orgName = `Diagnose Onboarding ${RUN_ID}`;
  const orgRes = await rest("POST", "organizations", {
    token,
    body: {
      name: orgName,
      slug: `${slugify(orgName)}-${Math.random().toString(36).slice(2, 6)}`,
      industry: null,
      created_by: userId,
    },
  });
  console.log(`status ${orgRes.status}`);
  console.log("response body:", JSON.stringify(orgRes.data, null, 2));
  const orgRow = Array.isArray(orgRes.data) ? orgRes.data[0] : orgRes.data;
  if (!orgRes.ok || !orgRow?.id) {
    console.error("\n>>> ORG INSERT/READ-BACK FAILED — this is the bug. See response body above.");
    await cleanup();
    process.exit(0);
  }
  orgId = orgRow.id;
  console.log(`Organization created and read back: ${orgId}\n`);

  console.log("--- 4. Insert warehouse (exact onboarding.tsx shape) ---");
  const whRes = await rest("POST", "warehouses", {
    token,
    body: {
      org_id: orgId,
      name: "Main Warehouse",
      code: "WH-01",
      city: null,
      country: "India",
    },
  });
  console.log(`status ${whRes.status}`);
  console.log("response body:", JSON.stringify(whRes.data, null, 2));
  if (!whRes.ok) {
    console.error("\n>>> WAREHOUSE INSERT FAILED — this is the bug. See response body above.");
    await cleanup();
    process.exit(0);
  }

  console.log("\n>>> Full onboarding flow succeeded with no errors.");
  await cleanup();
}

main().catch(async (err) => {
  console.error("\nDiagnostic script errored:", err);
  await cleanup();
  process.exit(1);
});
