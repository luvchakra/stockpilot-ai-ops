#!/usr/bin/env node
// Realistic demo/seed data for an existing StockPilot organization.
//
// Populates 9 categories, 5 warehouses, 9 suppliers, 12 customers, 30
// products, opening stock, ~20 purchase orders + items spread across all 8
// po_status values, ~24 sales orders + items spread across all 8 so_status
// values, a batch of sales invoices covering all 3 payment statuses,
// credit notes (both full and partial), debit notes, proforma invoices,
// ~14 stock transfers spread across all 7 stock_transfer_status values
// (including partial receives with damage, a cancellation before shipping,
// and a cancellation reversal in transit), several demo eway_bills/
// einvoices (including cancelled/expired ones), and a broader set of
// low-stock/stockout alerts. Multiple records per status/enum value are
// seeded (not just one) so every list/filter/report view has enough volume
// to look and behave like a real, in-use account.
//
// WHY DIRECT TABLE WRITES INSTEAD OF THE APP'S WORKFLOW RPCS:
// confirm_sales_order / ship_sales_order / cancel_sales_order /
// receive_purchase_order_item / ship_stock_transfer /
// receive_stock_transfer_item / create_credit_note / generate_sales_invoice
// all run as the calling user (not SECURITY DEFINER) and reference
// auth.uid() directly in their INSERT statements. Called via a bare
// service-role key there is no JWT subject, so auth.uid() is NULL and those
// inserts would violate NOT NULL actor columns. This script instead writes
// stock_movements/purchase_orders/sales_orders/etc rows directly, driving
// each order through its real status history with explicit PATCHes (so the
// existing audit_log triggers fire naturally) and posting the same
// stock_movements rows the RPCs would have posted, so stock_levels comes
// out via the ordinary apply_stock_movement() trigger. The three counter
// RPCs (next_sales_order_number / next_sales_invoice_number /
// next_credit_note_number) ARE used, since they only touch an org-scoped
// counter row and take no dependency on auth.uid().
//
// This performs real writes against your live project. Run it once against
// an org you're happy to see demo data in — re-running will create a
// second full set of demo orders (pass SEED_FORCE=1 to bypass the
// already-seeded guard and do that on purpose).
//
// Usage:
//   ORG_ID=<your-org-uuid> SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo-data.mjs
//
// ORG_ID: the organization to seed (find it via the Team page URL, or
// `select id from organizations` in the SQL editor). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are read from .env if present, same as
// scripts/test-tenant-rls.mjs.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = process.env.ORG_ID;

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL / VITE_SUPABASE_URL (checked .env and process.env).");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY. This script needs it to bypass RLS for direct writes.",
  );
  process.exit(1);
}
if (!ORG_ID) {
  console.error(
    "Missing ORG_ID. Set it to the organization you want to seed, e.g.\n" +
      "  ORG_ID=<uuid> SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo-data.mjs\n" +
      "Find your org's id in Supabase Studio (select id from organizations) or from the app's network requests.",
  );
  process.exit(1);
}

async function api(method, path, body) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  if (method !== "GET") headers.Prefer = "return=representation";
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }
  return data;
}

const get = (table, query) => api("GET", `/${table}?${query}`);
const insert = (table, rows) => api("POST", `/${table}`, rows);
const patch = (table, id, body) => api("PATCH", `/${table}?id=eq.${id}`, body);
const rpc = (fn, args) => api("POST", `/rpc/${fn}`, args ?? {});

async function findOrCreate(table, matchQuery, row, label) {
  const existing = await get(table, `${matchQuery}&select=id`);
  if (existing.length) {
    console.log(`  = ${label} already exists, reusing`);
    return existing[0].id;
  }
  const [created] = await insert(table, [row]);
  console.log(`  + ${label}`);
  return created.id;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Same-state → CGST+SGST split; cross-state → IGST. Mirrors the split used
// throughout the app's own GST calculations (see src/lib/gst.ts).
function taxSplit(taxableValue, rate, partyState, warehouseState) {
  const totalTax = round2((taxableValue * rate) / 100);
  if (partyState && warehouseState && partyState === warehouseState) {
    const half = round2(totalTax / 2);
    return { cgst: half, sgst: round2(totalTax - half), igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: totalTax };
}

function fakeIrn(seed) {
  return createHash("sha256").update(seed).digest("hex");
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function insertMovement(
  orgId,
  { product_id, warehouse_id, type, quantity, reference, notes, created_by },
) {
  await insert("stock_movements", [
    {
      org_id: orgId,
      product_id,
      warehouse_id,
      type,
      quantity,
      reference: reference ?? null,
      notes: notes ?? null,
      created_by,
    },
  ]);
}

async function main() {
  console.log(`Seeding demo data into org ${ORG_ID}\n`);

  const [org] = await get("organizations", `id=eq.${ORG_ID}&select=*`);
  if (!org) {
    console.error(`No organization found with id ${ORG_ID}.`);
    process.exit(1);
  }
  console.log(`Organization: ${org.name} (${org.slug})`);

  let [owner] = await get(
    "organization_members",
    `org_id=eq.${ORG_ID}&role=eq.owner&select=user_id&limit=1`,
  );
  if (!owner) {
    [owner] = await get(
      "organization_members",
      `org_id=eq.${ORG_ID}&role=eq.admin&select=user_id&limit=1`,
    );
  }
  if (!owner) {
    console.error(
      `No owner/admin member found for org ${ORG_ID} — add one before seeding (actor columns need a real user id).`,
    );
    process.exit(1);
  }
  const ACTOR = owner.user_id;
  console.log(`Acting as member: ${ACTOR}\n`);

  const alreadySeeded = await get(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Electronics&select=id`,
  );
  if (alreadySeeded.length && process.env.SEED_FORCE !== "1") {
    console.log(
      "Demo data already looks present for this org (found category 'Electronics'). " +
        "Skipping to avoid duplicate orders. Set SEED_FORCE=1 to seed another full batch anyway.",
    );
    return;
  }

  // ---------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------
  console.log("Categories:");
  const catId = {};
  catId.electronics = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Electronics`,
    { org_id: ORG_ID, name: "Electronics", description: "Consumer electronics and gadgets" },
    "Electronics",
  );
  catId.mobileAccessories = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Mobile Accessories`,
    {
      org_id: ORG_ID,
      name: "Mobile Accessories",
      description: "Cases, chargers and add-ons for phones",
      parent_id: catId.electronics,
    },
    "Mobile Accessories",
  );
  catId.office = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Office Supplies`,
    { org_id: ORG_ID, name: "Office Supplies", description: "Stationery and office consumables" },
    "Office Supplies",
  );
  catId.packaging = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Packaging Materials`,
    {
      org_id: ORG_ID,
      name: "Packaging Materials",
      description: "Boxes, wrap and tape for shipping",
    },
    "Packaging Materials",
  );
  catId.rawMaterials = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Raw Materials`,
    { org_id: ORG_ID, name: "Raw Materials", description: "Inputs used in light assembly" },
    "Raw Materials",
  );
  catId.furniture = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Furniture`,
    { org_id: ORG_ID, name: "Furniture", description: "Office furniture and fixtures" },
    "Furniture",
  );
  catId.itPeripherals = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.IT Peripherals`,
    { org_id: ORG_ID, name: "IT Peripherals", description: "Computer accessories and peripherals" },
    "IT Peripherals",
  );
  catId.cleaning = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Cleaning Supplies`,
    {
      org_id: ORG_ID,
      name: "Cleaning Supplies",
      description: "Janitorial and cleaning consumables",
    },
    "Cleaning Supplies",
  );
  catId.foodBeverage = await findOrCreate(
    "categories",
    `org_id=eq.${ORG_ID}&name=eq.Food & Beverage`,
    { org_id: ORG_ID, name: "Food & Beverage", description: "Packaged food and beverage items" },
    "Food & Beverage",
  );

  // ---------------------------------------------------------------------
  // Warehouses
  // ---------------------------------------------------------------------
  console.log("\nWarehouses:");
  const wh = {};
  wh.mum = await findOrCreate(
    "warehouses",
    `org_id=eq.${ORG_ID}&code=eq.MUM-WH1`,
    {
      org_id: ORG_ID,
      code: "MUM-WH1",
      name: "Mumbai Central Warehouse",
      type: "main",
      address: "Plot 14, MIDC Industrial Area",
      city: "Mumbai",
      state: "Maharashtra",
      postal_code: "400093",
      contact_name: "Ramesh Kulkarni",
      contact_phone: "+91 98200 11223",
    },
    "Mumbai Central Warehouse (MUM-WH1)",
  );
  wh.blr = await findOrCreate(
    "warehouses",
    `org_id=eq.${ORG_ID}&code=eq.BLR-WH1`,
    {
      org_id: ORG_ID,
      code: "BLR-WH1",
      name: "Bengaluru Fulfillment Center",
      type: "fulfillment",
      address: "Survey No. 27, Electronics City Phase 2",
      city: "Bengaluru",
      state: "Karnataka",
      postal_code: "560100",
      contact_name: "Anitha Reddy",
      contact_phone: "+91 98450 33445",
    },
    "Bengaluru Fulfillment Center (BLR-WH1)",
  );
  wh.del = await findOrCreate(
    "warehouses",
    `org_id=eq.${ORG_ID}&code=eq.DEL-WH1`,
    {
      org_id: ORG_ID,
      code: "DEL-WH1",
      name: "Delhi Regional Hub",
      type: "regional",
      address: "Khasra No. 112, Narela Industrial Area",
      city: "Delhi",
      state: "Delhi",
      postal_code: "110040",
      contact_name: "Vikram Chauhan",
      contact_phone: "+91 98110 55667",
    },
    "Delhi Regional Hub (DEL-WH1)",
  );
  wh.hyd = await findOrCreate(
    "warehouses",
    `org_id=eq.${ORG_ID}&code=eq.HYD-WH1`,
    {
      org_id: ORG_ID,
      code: "HYD-WH1",
      name: "Hyderabad Distribution Center",
      type: "regional",
      address: "Plot 9, Gachibowli Industrial Layout",
      city: "Hyderabad",
      state: "Telangana",
      postal_code: "500032",
      contact_name: "Srinivas Rao",
      contact_phone: "+91 90000 77889",
    },
    "Hyderabad Distribution Center (HYD-WH1)",
  );
  wh.kol = await findOrCreate(
    "warehouses",
    `org_id=eq.${ORG_ID}&code=eq.KOL-WH1`,
    {
      org_id: ORG_ID,
      code: "KOL-WH1",
      name: "Kolkata Eastern Warehouse",
      type: "regional",
      address: "18, Taratala Road Industrial Estate",
      city: "Kolkata",
      state: "West Bengal",
      postal_code: "700088",
      contact_name: "Debashree Sen",
      contact_phone: "+91 90070 99001",
    },
    "Kolkata Eastern Warehouse (KOL-WH1)",
  );
  const whState = {
    [wh.mum]: "Maharashtra",
    [wh.blr]: "Karnataka",
    [wh.del]: "Delhi",
    [wh.hyd]: "Telangana",
    [wh.kol]: "West Bengal",
  };

  // ---------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------
  console.log("\nSuppliers:");
  const sup = {};
  sup.shree = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-SHR01`,
    {
      org_id: ORG_ID,
      code: "SUP-SHR01",
      name: "Shree Electronics Distributors",
      contact_person: "Manoj Shah",
      email: "sales@shreeelectronics.example.in",
      phone: "+91 22 2765 4321",
      address: "Lamington Road",
      city: "Mumbai",
      state: "Maharashtra",
      gst_number: "27AASFS1234A1Z5",
      payment_terms: "Net 30",
      lead_time_days: 7,
      rating: 4.5,
    },
    "Shree Electronics Distributors",
  );
  sup.bharat = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-BHR01`,
    {
      org_id: ORG_ID,
      code: "SUP-BHR01",
      name: "Bharat Packaging Solutions",
      contact_person: "Kavya Nair",
      email: "orders@bharatpackaging.example.in",
      phone: "+91 80 4123 7890",
      address: "Peenya Industrial Area",
      city: "Bengaluru",
      state: "Karnataka",
      gst_number: "29AABCB5678B2Z6",
      payment_terms: "Net 15",
      lead_time_days: 5,
      rating: 4.2,
    },
    "Bharat Packaging Solutions",
  );
  sup.national = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-NAT01`,
    {
      org_id: ORG_ID,
      code: "SUP-NAT01",
      name: "National Office Traders",
      contact_person: "Suresh Bhatia",
      email: "info@nationaloffice.example.in",
      phone: "+91 11 2345 6789",
      address: "Naraina Industrial Area",
      city: "Delhi",
      state: "Delhi",
      gst_number: "07AAACN2345C3Z7",
      payment_terms: "Net 30",
      lead_time_days: 4,
      rating: 4.0,
    },
    "National Office Traders",
  );
  sup.sundar = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-SUN01`,
    {
      org_id: ORG_ID,
      code: "SUP-SUN01",
      name: "Sundar Raw Materials Pvt Ltd",
      contact_person: "Lakshmi Iyer",
      email: "procurement@sundarraw.example.in",
      phone: "+91 44 2891 0123",
      address: "Ambattur Industrial Estate",
      city: "Chennai",
      state: "Tamil Nadu",
      gst_number: "33AABCS3456D4Z8",
      payment_terms: "Net 45",
      lead_time_days: 10,
      min_order_quantity: 10,
      rating: 4.3,
    },
    "Sundar Raw Materials Pvt Ltd",
  );
  sup.global = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-GLB01`,
    {
      org_id: ORG_ID,
      code: "SUP-GLB01",
      name: "Global Mobile Components",
      contact_person: "Farhan Sheikh",
      email: "sales@globalmobile.example.in",
      phone: "+91 20 6712 3456",
      address: "Hinjewadi Phase 1",
      city: "Pune",
      state: "Maharashtra",
      gst_number: "27AABCG4567E5Z9",
      payment_terms: "Net 30",
      lead_time_days: 12,
      rating: 3.9,
    },
    "Global Mobile Components",
  );
  sup.trident = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-TRD01`,
    {
      org_id: ORG_ID,
      code: "SUP-TRD01",
      name: "Trident Furniture Works",
      contact_person: "Naveen Rao",
      email: "sales@tridentfurniture.example.in",
      phone: "+91 40 2712 3456",
      address: "IDA Gandhinagar",
      city: "Hyderabad",
      state: "Telangana",
      gst_number: "36AABCT6789J1Z4",
      payment_terms: "Net 45",
      lead_time_days: 15,
      min_order_quantity: 5,
      rating: 4.1,
    },
    "Trident Furniture Works",
  );
  sup.bytelink = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-BTL01`,
    {
      org_id: ORG_ID,
      code: "SUP-BTL01",
      name: "ByteLink IT Peripherals",
      contact_person: "Divya Prasad",
      email: "orders@bytelink.example.in",
      phone: "+91 80 4956 2345",
      address: "Whitefield Main Road",
      city: "Bengaluru",
      state: "Karnataka",
      gst_number: "29AABCB7890K2Z5",
      payment_terms: "Net 30",
      lead_time_days: 8,
      rating: 4.4,
    },
    "ByteLink IT Peripherals",
  );
  sup.cleanpro = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-CLP01`,
    {
      org_id: ORG_ID,
      code: "SUP-CLP01",
      name: "CleanPro Chemicals",
      contact_person: "Ritwik Ghosh",
      email: "sales@cleanprochemicals.example.in",
      phone: "+91 33 2401 5678",
      address: "Taratala Industrial Estate",
      city: "Kolkata",
      state: "West Bengal",
      gst_number: "19AABCC8901L3Z6",
      payment_terms: "Net 15",
      lead_time_days: 6,
      rating: 4.0,
    },
    "CleanPro Chemicals",
  );
  sup.anandFoods = await findOrCreate(
    "suppliers",
    `org_id=eq.${ORG_ID}&code=eq.SUP-AND01`,
    {
      org_id: ORG_ID,
      code: "SUP-AND01",
      name: "Anand Foods & Beverages",
      contact_person: "Jignesh Patel",
      email: "orders@anandfoods.example.in",
      phone: "+91 79 2630 4567",
      address: "Vatva Industrial Estate",
      city: "Ahmedabad",
      state: "Gujarat",
      gst_number: "24AABCA9012M4Z7",
      payment_terms: "Net 21",
      lead_time_days: 9,
      min_order_quantity: 20,
      rating: 4.2,
    },
    "Anand Foods & Beverages",
  );

  // ---------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------
  console.log("\nCustomers:");
  const cust = {};
  cust.chopra = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Chopra Retail Mart`,
    {
      org_id: ORG_ID,
      name: "Chopra Retail Mart",
      email: "purchase@chopraretail.example.in",
      phone: "+91 98200 12121",
      gstin: "27AAWFC6789F6Z0",
      state: "Maharashtra",
      billing_address: "Shop 4, Linking Road, Mumbai, Maharashtra 400050",
      shipping_address: "Shop 4, Linking Road, Mumbai, Maharashtra 400050",
    },
    "Chopra Retail Mart",
  );
  cust.technova = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.TechNova Solutions`,
    {
      org_id: ORG_ID,
      name: "TechNova Solutions",
      email: "accounts@technova.example.in",
      phone: "+91 98450 23232",
      gstin: "29AABCT7890G7Z1",
      state: "Karnataka",
      billing_address: "4th Floor, Bagmane Tech Park, Bengaluru, Karnataka 560093",
      shipping_address: "4th Floor, Bagmane Tech Park, Bengaluru, Karnataka 560093",
    },
    "TechNova Solutions",
  );
  cust.capital = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Capital Traders`,
    {
      org_id: ORG_ID,
      name: "Capital Traders",
      email: "buying@capitaltraders.example.in",
      phone: "+91 98110 34343",
      gstin: "07AABFC8901H8Z2",
      state: "Delhi",
      billing_address: "B-22, Nehru Place, New Delhi, Delhi 110019",
      shipping_address: "B-22, Nehru Place, New Delhi, Delhi 110019",
    },
    "Capital Traders",
  );
  cust.priya = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Priya Sharma`,
    {
      org_id: ORG_ID,
      name: "Priya Sharma",
      email: "priya.sharma@example.in",
      phone: "+91 98220 45454",
      state: "Maharashtra",
      billing_address: "Flat 302, Sunrise Apartments, Andheri East, Mumbai, Maharashtra 400069",
      shipping_address: "Flat 302, Sunrise Apartments, Andheri East, Mumbai, Maharashtra 400069",
    },
    "Priya Sharma",
  );
  cust.arjun = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Arjun Mehta`,
    {
      org_id: ORG_ID,
      name: "Arjun Mehta",
      email: "arjun.mehta@example.in",
      phone: "+91 98860 56565",
      state: "Karnataka",
      billing_address: "12, Indiranagar 1st Stage, Bengaluru, Karnataka 560038",
      shipping_address: "12, Indiranagar 1st Stage, Bengaluru, Karnataka 560038",
    },
    "Arjun Mehta",
  );
  cust.freshmart = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Fresh Mart Supermarket`,
    {
      org_id: ORG_ID,
      name: "Fresh Mart Supermarket",
      email: "supply@freshmart.example.in",
      phone: "+91 98200 67676",
      gstin: "27AADFF9012I9Z3",
      state: "Maharashtra",
      billing_address: "Ground Floor, Powai Plaza, Mumbai, Maharashtra 400076",
      shipping_address: "Ground Floor, Powai Plaza, Mumbai, Maharashtra 400076",
    },
    "Fresh Mart Supermarket",
  );
  cust.deccan = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Deccan Enterprises`,
    {
      org_id: ORG_ID,
      name: "Deccan Enterprises",
      email: "purchase@deccanenterprises.example.in",
      phone: "+91 90000 78787",
      gstin: "36AAJFD0123N0Z4",
      state: "Telangana",
      billing_address: "5-9-22, Abids Road, Hyderabad, Telangana 500001",
      shipping_address: "5-9-22, Abids Road, Hyderabad, Telangana 500001",
    },
    "Deccan Enterprises",
  );
  cust.eastern = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Eastern Retail Hub`,
    {
      org_id: ORG_ID,
      name: "Eastern Retail Hub",
      email: "buying@easternretailhub.example.in",
      phone: "+91 90070 89898",
      gstin: "19AAJFE1234O1Z5",
      state: "West Bengal",
      billing_address: "22, Park Street, Kolkata, West Bengal 700016",
      shipping_address: "22, Park Street, Kolkata, West Bengal 700016",
    },
    "Eastern Retail Hub",
  );
  cust.rohan = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Rohan Verma`,
    {
      org_id: ORG_ID,
      name: "Rohan Verma",
      email: "rohan.verma@example.in",
      phone: "+91 98110 90909",
      state: "Delhi",
      billing_address: "C-14, Lajpat Nagar, New Delhi, Delhi 110024",
      shipping_address: "C-14, Lajpat Nagar, New Delhi, Delhi 110024",
    },
    "Rohan Verma",
  );
  cust.sneha = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Sneha Iyer`,
    {
      org_id: ORG_ID,
      name: "Sneha Iyer",
      email: "sneha.iyer@example.in",
      phone: "+91 94440 12121",
      state: "Tamil Nadu",
      billing_address: "18, T Nagar, Chennai, Tamil Nadu 600017",
      shipping_address: "18, T Nagar, Chennai, Tamil Nadu 600017",
    },
    "Sneha Iyer",
  );
  cust.globalOffice = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Global Office Systems`,
    {
      org_id: ORG_ID,
      name: "Global Office Systems",
      email: "procurement@globalofficesystems.example.in",
      phone: "+91 98450 23434",
      gstin: "29AAKFG2345P2Z6",
      state: "Karnataka",
      billing_address: "3rd Cross, HSR Layout, Bengaluru, Karnataka 560102",
      shipping_address: "3rd Cross, HSR Layout, Bengaluru, Karnataka 560102",
    },
    "Global Office Systems",
  );
  cust.meera = await findOrCreate(
    "customers",
    `org_id=eq.${ORG_ID}&name=eq.Meera Kapoor`,
    {
      org_id: ORG_ID,
      name: "Meera Kapoor",
      email: "meera.kapoor@example.in",
      phone: "+91 90000 34545",
      state: "Telangana",
      billing_address: "Flat 6B, Jubilee Hills, Hyderabad, Telangana 500033",
      shipping_address: "Flat 6B, Jubilee Hills, Hyderabad, Telangana 500033",
    },
    "Meera Kapoor",
  );

  // ---------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------
  console.log("\nProducts:");
  const productDefs = [
    {
      sku: "ELEC-001",
      name: "Wireless Bluetooth Earbuds",
      brand: "SonicWave",
      category: catId.electronics,
      supplier: sup.shree,
      hsn: "85183000",
      unit: "pcs",
      cost: 650,
      price: 1299,
      tax: 18,
      rp: 20,
      rq: 100,
    },
    {
      sku: "ELEC-002",
      name: "USB-C Fast Charger 20W",
      brand: "SonicWave",
      category: catId.electronics,
      supplier: sup.shree,
      hsn: "85044090",
      unit: "pcs",
      cost: 220,
      price: 499,
      tax: 18,
      rp: 30,
      rq: 150,
    },
    {
      sku: "ELEC-003",
      name: "Portable Power Bank 10000mAh",
      brand: "VoltPack",
      category: catId.electronics,
      supplier: sup.shree,
      hsn: "85076000",
      unit: "pcs",
      cost: 480,
      price: 999,
      tax: 18,
      rp: 15,
      rq: 80,
    },
    {
      sku: "ELEC-004",
      name: "Smart LED Desk Lamp",
      brand: "BrightHome",
      category: catId.electronics,
      supplier: sup.shree,
      hsn: "94051090",
      unit: "pcs",
      cost: 420,
      price: 899,
      tax: 18,
      rp: 12,
      rq: 60,
    },
    {
      sku: "MOB-001",
      name: "Tempered Glass Screen Protector",
      brand: "ShieldX",
      category: catId.mobileAccessories,
      supplier: sup.global,
      hsn: "70071900",
      unit: "pcs",
      cost: 25,
      price: 99,
      tax: 18,
      rp: 100,
      rq: 500,
    },
    {
      sku: "MOB-002",
      name: "Silicone Phone Case",
      brand: "ShieldX",
      category: catId.mobileAccessories,
      supplier: sup.global,
      hsn: "39269099",
      unit: "pcs",
      cost: 40,
      price: 149,
      tax: 18,
      rp: 80,
      rq: 400,
    },
    {
      sku: "MOB-003",
      name: "Car Mobile Holder",
      brand: "DriveMate",
      category: catId.mobileAccessories,
      supplier: sup.global,
      hsn: "87089900",
      unit: "pcs",
      cost: 90,
      price: 249,
      tax: 18,
      rp: 25,
      rq: 120,
    },
    {
      sku: "OFF-001",
      name: "A4 Copier Paper (500 sheets)",
      brand: "PaperPro",
      category: catId.office,
      supplier: sup.national,
      hsn: "48201090",
      unit: "ream",
      cost: 210,
      price: 320,
      tax: 12,
      rp: 50,
      rq: 300,
    },
    {
      sku: "OFF-002",
      name: "Gel Pens Pack of 10",
      brand: "WriteWell",
      category: catId.office,
      supplier: sup.national,
      hsn: "96081010",
      unit: "pack",
      cost: 45,
      price: 89,
      tax: 12,
      rp: 60,
      rq: 300,
    },
    {
      sku: "OFF-003",
      name: "Stapler Heavy Duty",
      brand: "OfficeGrip",
      category: catId.office,
      supplier: sup.national,
      hsn: "84725100",
      unit: "pcs",
      cost: 95,
      price: 199,
      tax: 12,
      rp: 20,
      rq: 80,
    },
    {
      sku: "OFF-004",
      name: "Whiteboard Marker Set",
      brand: "WriteWell",
      category: catId.office,
      supplier: sup.national,
      hsn: "96081010",
      unit: "set",
      cost: 60,
      price: 129,
      tax: 12,
      rp: 40,
      rq: 200,
    },
    {
      sku: "PKG-001",
      name: "Corrugated Box Medium (12x9x6in)",
      brand: "PackRight",
      category: catId.packaging,
      supplier: sup.bharat,
      hsn: "48191010",
      unit: "pcs",
      cost: 12,
      price: 25,
      tax: 12,
      rp: 200,
      rq: 1000,
    },
    {
      sku: "PKG-002",
      name: "Bubble Wrap Roll 50m",
      brand: "PackRight",
      category: catId.packaging,
      supplier: sup.bharat,
      hsn: "39232990",
      unit: "roll",
      cost: 350,
      price: 599,
      tax: 12,
      rp: 10,
      rq: 40,
    },
    {
      sku: "PKG-003",
      name: "Packing Tape (Pack of 6)",
      brand: "PackRight",
      category: catId.packaging,
      supplier: sup.bharat,
      hsn: "39191090",
      unit: "pack",
      cost: 180,
      price: 299,
      tax: 18,
      rp: 25,
      rq: 100,
    },
    {
      sku: "RAW-001",
      name: "ABS Plastic Granules 25kg",
      brand: "PolyBase",
      category: catId.rawMaterials,
      supplier: sup.sundar,
      hsn: "39033000",
      unit: "bag",
      cost: 2800,
      price: 3600,
      tax: 18,
      rp: 15,
      rq: 60,
    },
    {
      sku: "RAW-002",
      name: "Steel Sheet 2mm (per unit)",
      brand: "IronCore",
      category: catId.rawMaterials,
      supplier: sup.sundar,
      hsn: "72042900",
      unit: "sheet",
      cost: 1450,
      price: 1850,
      tax: 18,
      rp: 10,
      rq: 40,
    },
    {
      sku: "MOB-004",
      name: "Wireless Charging Pad 15W",
      brand: "ShieldX",
      category: catId.mobileAccessories,
      supplier: sup.global,
      hsn: "85044090",
      unit: "pcs",
      cost: 320,
      price: 699,
      tax: 18,
      rp: 25,
      rq: 120,
    },
    {
      sku: "FURN-001",
      name: "Ergonomic Office Chair",
      brand: "ErgoSit",
      category: catId.furniture,
      supplier: sup.trident,
      hsn: "94013000",
      unit: "pcs",
      cost: 3200,
      price: 5499,
      tax: 18,
      rp: 8,
      rq: 30,
    },
    {
      sku: "FURN-002",
      name: "Adjustable Standing Desk",
      brand: "ErgoSit",
      category: catId.furniture,
      supplier: sup.trident,
      hsn: "94033000",
      unit: "pcs",
      cost: 6500,
      price: 10999,
      tax: 18,
      rp: 5,
      rq: 20,
    },
    {
      sku: "FURN-003",
      name: "3-Drawer Filing Cabinet",
      brand: "SteelForm",
      category: catId.furniture,
      supplier: sup.trident,
      hsn: "94032090",
      unit: "pcs",
      cost: 2800,
      price: 4499,
      tax: 18,
      rp: 6,
      rq: 25,
    },
    {
      sku: "ITP-001",
      name: "Wireless Optical Mouse",
      brand: "ByteLink",
      category: catId.itPeripherals,
      supplier: sup.bytelink,
      hsn: "84716060",
      unit: "pcs",
      cost: 210,
      price: 449,
      tax: 18,
      rp: 40,
      rq: 200,
    },
    {
      sku: "ITP-002",
      name: "Mechanical Keyboard",
      brand: "ByteLink",
      category: catId.itPeripherals,
      supplier: sup.bytelink,
      hsn: "84716070",
      unit: "pcs",
      cost: 1100,
      price: 1999,
      tax: 18,
      rp: 20,
      rq: 80,
    },
    {
      sku: "ITP-003",
      name: "24-inch Full HD Monitor",
      brand: "ByteLink",
      category: catId.itPeripherals,
      supplier: sup.bytelink,
      hsn: "85285900",
      unit: "pcs",
      cost: 6200,
      price: 9499,
      tax: 18,
      rp: 10,
      rq: 40,
    },
    {
      sku: "ITP-004",
      name: "USB Hub 4-Port",
      brand: "ByteLink",
      category: catId.itPeripherals,
      supplier: sup.bytelink,
      hsn: "84716090",
      unit: "pcs",
      cost: 180,
      price: 399,
      tax: 18,
      rp: 30,
      rq: 150,
    },
    {
      sku: "CLN-001",
      name: "Multi-Surface Disinfectant Spray 500ml",
      brand: "CleanPro",
      category: catId.cleaning,
      supplier: sup.cleanpro,
      hsn: "34029090",
      unit: "pcs",
      cost: 85,
      price: 165,
      tax: 18,
      rp: 60,
      rq: 300,
    },
    {
      sku: "CLN-002",
      name: "Microfiber Cleaning Cloth Pack of 5",
      brand: "CleanPro",
      category: catId.cleaning,
      supplier: sup.cleanpro,
      hsn: "63071090",
      unit: "pack",
      cost: 90,
      price: 179,
      tax: 12,
      rp: 40,
      rq: 200,
    },
    {
      sku: "CLN-003",
      name: "Floor Cleaner 5L",
      brand: "CleanPro",
      category: catId.cleaning,
      supplier: sup.cleanpro,
      hsn: "34022090",
      unit: "can",
      cost: 220,
      price: 399,
      tax: 18,
      rp: 25,
      rq: 100,
    },
    {
      sku: "FB-001",
      name: "Assorted Cookies 200g",
      brand: "Anand Snacks",
      category: catId.foodBeverage,
      supplier: sup.anandFoods,
      hsn: "19053100",
      unit: "pack",
      cost: 35,
      price: 65,
      tax: 5,
      rp: 100,
      rq: 500,
    },
    {
      sku: "FB-002",
      name: "Instant Coffee Premix 1kg",
      brand: "Anand Snacks",
      category: catId.foodBeverage,
      supplier: sup.anandFoods,
      hsn: "21011100",
      unit: "jar",
      cost: 340,
      price: 549,
      tax: 5,
      rp: 30,
      rq: 150,
    },
    {
      sku: "FB-003",
      name: "Bottled Drinking Water 1L (Case of 12)",
      brand: "Anand Snacks",
      category: catId.foodBeverage,
      supplier: sup.anandFoods,
      hsn: "22011010",
      unit: "case",
      cost: 96,
      price: 156,
      tax: 12,
      rp: 50,
      rq: 250,
    },
  ];
  const prod = {};
  for (const p of productDefs) {
    const id = await findOrCreate(
      "products",
      `org_id=eq.${ORG_ID}&sku=eq.${p.sku}`,
      {
        org_id: ORG_ID,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category_id: p.category,
        supplier_id: p.supplier,
        hsn_code: p.hsn,
        unit: p.unit,
        cost_price: p.cost,
        selling_price: p.price,
        tax_rate: p.tax,
        reorder_point: p.rp,
        reorder_quantity: p.rq,
        status: "active",
        description: `${p.name} — sourced and resold as part of the standard catalog.`,
      },
      `${p.sku} — ${p.name}`,
    );
    prod[p.sku] = { id, ...p };
  }

  // ---------------------------------------------------------------------
  // Opening stock (drives stock_levels via the apply_stock_movement trigger)
  // ---------------------------------------------------------------------
  console.log("\nOpening stock:");
  const opening = [
    ["ELEC-001", wh.mum, 15],
    ["ELEC-001", wh.blr, 60],
    ["ELEC-002", wh.mum, 200],
    ["ELEC-002", wh.blr, 40],
    ["ELEC-002", wh.del, 30],
    ["ELEC-003", wh.mum, 8],
    ["ELEC-003", wh.del, 25],
    ["ELEC-004", wh.mum, 55],
    ["MOB-001", wh.mum, 600],
    ["MOB-001", wh.blr, 300],
    ["MOB-002", wh.mum, 350],
    ["MOB-002", wh.blr, 150],
    ["MOB-003", wh.mum, 90],
    ["MOB-003", wh.del, 40],
    ["OFF-001", wh.mum, 400],
    ["OFF-001", wh.del, 200],
    ["OFF-002", wh.mum, 250],
    ["OFF-003", wh.mum, 15],
    ["OFF-004", wh.mum, 180],
    ["PKG-001", wh.mum, 1500],
    ["PKG-001", wh.blr, 800],
    ["PKG-001", wh.hyd, 400],
    ["PKG-002", wh.mum, 5],
    ["PKG-003", wh.mum, 120],
    ["RAW-001", wh.mum, 45],
    // RAW-002 deliberately left with zero opening stock at MUM to demo a stockout alert.
    ["MOB-004", wh.mum, 150],
    ["MOB-004", wh.blr, 70],
    ["ELEC-001", wh.hyd, 20],
    ["OFF-001", wh.kol, 150],
    ["FURN-001", wh.hyd, 12],
    ["FURN-002", wh.hyd, 4],
    ["FURN-003", wh.hyd, 10],
    ["ITP-001", wh.blr, 150],
    ["ITP-001", wh.hyd, 60],
    ["ITP-002", wh.blr, 50],
    ["ITP-003", wh.blr, 8],
    ["ITP-004", wh.blr, 80],
    ["CLN-001", wh.kol, 200],
    ["CLN-002", wh.kol, 120],
    ["CLN-003", wh.kol, 15],
    ["FB-001", wh.kol, 300],
    ["FB-002", wh.kol, 80],
    ["FB-003", wh.kol, 60],
  ];
  for (const [sku, warehouse_id, quantity] of opening) {
    await insertMovement(ORG_ID, {
      product_id: prod[sku].id,
      warehouse_id,
      type: "inbound",
      quantity,
      notes: "Opening stock balance",
      created_by: ACTOR,
    });
  }
  console.log(`  + posted ${opening.length} opening-stock movements`);

  // ---------------------------------------------------------------------
  // Purchase orders — one per po_status value
  // ---------------------------------------------------------------------
  console.log("\nPurchase orders:");

  async function createPo({ number, supplierId, warehouseId, orderDaysAgo, items, statusChain }) {
    const supplierState = (await get("suppliers", `id=eq.${supplierId}&select=state`))[0].state;
    let subtotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    const itemRows = items.map(({ sku, quantity }) => {
      const p = prod[sku];
      const lineSubtotal = round2(p.cost * quantity);
      const split = taxSplit(lineSubtotal, p.tax, supplierState, whState[warehouseId]);
      subtotal += lineSubtotal;
      cgst += split.cgst;
      sgst += split.sgst;
      igst += split.igst;
      return { product_id: p.id, quantity, unit_cost: p.cost, tax_rate: p.tax, ...split };
    });
    subtotal = round2(subtotal);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const total = round2(subtotal + cgst + sgst + igst);

    const [po] = await insert("purchase_orders", [
      {
        org_id: ORG_ID,
        po_number: number,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        order_date: daysAgo(orderDaysAgo),
        status: "draft",
        created_by: ACTOR,
        subtotal,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        tax_amount: round2(cgst + sgst + igst),
        total_amount: total,
        expected_delivery_date: daysAgo(orderDaysAgo - 10),
      },
    ]);
    const insertedItems = await insert(
      "purchase_order_items",
      itemRows.map((row) => ({ org_id: ORG_ID, purchase_order_id: po.id, ...row })),
    );

    for (const status of statusChain.slice(1)) {
      await patch("purchase_orders", po.id, { status });
    }
    console.log(`  + ${number} (${statusChain[statusChain.length - 1]})`);
    return { po, items: insertedItems };
  }

  async function receivePoItems(poItems, fractions) {
    for (let i = 0; i < poItems.length; i++) {
      const item = poItems[i];
      const fraction = fractions[i] ?? 1;
      if (fraction <= 0) continue;
      const receivedQty = round2(item.quantity * fraction);
      await insertMovement(ORG_ID, {
        product_id: item.product_id,
        warehouse_id: item._warehouseId,
        type: "inbound",
        quantity: receivedQty,
        reference: item._poNumber,
        notes: "Received against purchase order",
        created_by: ACTOR,
      });
      await patch("purchase_order_items", item.id, { received_quantity: receivedQty });
    }
  }

  await createPo({
    number: "PO-DEMO-0001",
    supplierId: sup.global,
    warehouseId: wh.mum,
    orderDaysAgo: 3,
    items: [
      { sku: "MOB-001", quantity: 200 },
      { sku: "MOB-003", quantity: 60 },
    ],
    statusChain: ["draft"],
  });
  await createPo({
    number: "PO-DEMO-0002",
    supplierId: sup.national,
    warehouseId: wh.mum,
    orderDaysAgo: 5,
    items: [
      { sku: "OFF-002", quantity: 150 },
      { sku: "OFF-004", quantity: 100 },
    ],
    statusChain: ["draft", "pending_approval"],
  });
  await createPo({
    number: "PO-DEMO-0003",
    supplierId: sup.shree,
    warehouseId: wh.mum,
    orderDaysAgo: 7,
    items: [{ sku: "ELEC-002", quantity: 100 }],
    statusChain: ["draft", "pending_approval", "approved"],
  });
  await createPo({
    number: "PO-DEMO-0004",
    supplierId: sup.bharat,
    warehouseId: wh.mum,
    orderDaysAgo: 6,
    items: [
      { sku: "PKG-002", quantity: 30 },
      { sku: "PKG-003", quantity: 50 },
    ],
    statusChain: ["draft", "pending_approval", "approved", "sent"],
  });
  const po5 = await createPo({
    number: "PO-DEMO-0005",
    supplierId: sup.sundar,
    warehouseId: wh.mum,
    orderDaysAgo: 14,
    items: [{ sku: "RAW-001", quantity: 40 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "partially_received"],
  });
  po5.items.forEach((it) => {
    it._warehouseId = wh.mum;
    it._poNumber = "PO-DEMO-0005";
  });
  await receivePoItems(po5.items, [0.5]);

  const po6 = await createPo({
    number: "PO-DEMO-0006",
    supplierId: sup.shree,
    warehouseId: wh.del,
    orderDaysAgo: 20,
    items: [{ sku: "ELEC-003", quantity: 60 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received"],
  });
  po6.items.forEach((it) => {
    it._warehouseId = wh.del;
    it._poNumber = "PO-DEMO-0006";
  });
  await receivePoItems(po6.items, [1]);

  const po7 = await createPo({
    number: "PO-DEMO-0007",
    supplierId: sup.national,
    warehouseId: wh.mum,
    orderDaysAgo: 30,
    items: [{ sku: "OFF-001", quantity: 300 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received", "closed"],
  });
  po7.items.forEach((it) => {
    it._warehouseId = wh.mum;
    it._poNumber = "PO-DEMO-0007";
  });
  await receivePoItems(po7.items, [1]);

  await createPo({
    number: "PO-DEMO-0008",
    supplierId: sup.bharat,
    warehouseId: wh.blr,
    orderDaysAgo: 4,
    items: [{ sku: "PKG-001", quantity: 500 }],
    statusChain: ["draft", "pending_approval", "cancelled"],
  });

  // Extra purchase orders — more volume per status, exercising the new
  // suppliers/warehouses/products.
  await createPo({
    number: "PO-DEMO-0009",
    supplierId: sup.bytelink,
    warehouseId: wh.blr,
    orderDaysAgo: 2,
    items: [
      { sku: "ITP-002", quantity: 40 },
      { sku: "ITP-004", quantity: 60 },
    ],
    statusChain: ["draft"],
  });
  await createPo({
    number: "PO-DEMO-0010",
    supplierId: sup.cleanpro,
    warehouseId: wh.kol,
    orderDaysAgo: 3,
    items: [{ sku: "CLN-003", quantity: 80 }],
    statusChain: ["draft", "pending_approval"],
  });
  await createPo({
    number: "PO-DEMO-0011",
    supplierId: sup.trident,
    warehouseId: wh.hyd,
    orderDaysAgo: 9,
    items: [
      { sku: "FURN-001", quantity: 15 },
      { sku: "FURN-003", quantity: 10 },
    ],
    statusChain: ["draft", "pending_approval", "approved"],
  });
  await createPo({
    number: "PO-DEMO-0012",
    supplierId: sup.anandFoods,
    warehouseId: wh.kol,
    orderDaysAgo: 5,
    items: [
      { sku: "FB-001", quantity: 400 },
      { sku: "FB-003", quantity: 100 },
    ],
    statusChain: ["draft", "pending_approval", "approved", "sent"],
  });
  const po13 = await createPo({
    number: "PO-DEMO-0013",
    supplierId: sup.bytelink,
    warehouseId: wh.hyd,
    orderDaysAgo: 16,
    items: [{ sku: "ITP-003", quantity: 20 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "partially_received"],
  });
  po13.items.forEach((it) => {
    it._warehouseId = wh.hyd;
    it._poNumber = "PO-DEMO-0013";
  });
  await receivePoItems(po13.items, [0.4]);

  // Deliberately not received into wh.hyd (kept at wh.mum below) so the
  // Bengaluru ITP-003 shortfall and Hyderabad FURN-002 shortfall used for
  // the low-stock alerts further down stay unreplenished.
  const po14 = await createPo({
    number: "PO-DEMO-0014",
    supplierId: sup.trident,
    warehouseId: wh.mum,
    orderDaysAgo: 22,
    items: [{ sku: "FURN-002", quantity: 10 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received"],
  });
  po14.items.forEach((it) => {
    it._warehouseId = wh.mum;
    it._poNumber = "PO-DEMO-0014";
  });
  await receivePoItems(po14.items, [1]);

  const po15 = await createPo({
    number: "PO-DEMO-0015",
    supplierId: sup.global,
    warehouseId: wh.mum,
    orderDaysAgo: 18,
    items: [{ sku: "MOB-004", quantity: 150 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received"],
  });
  po15.items.forEach((it) => {
    it._warehouseId = wh.mum;
    it._poNumber = "PO-DEMO-0015";
  });
  await receivePoItems(po15.items, [1]);

  const po16 = await createPo({
    number: "PO-DEMO-0016",
    supplierId: sup.national,
    warehouseId: wh.del,
    orderDaysAgo: 35,
    items: [{ sku: "OFF-003", quantity: 60 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received", "closed"],
  });
  po16.items.forEach((it) => {
    it._warehouseId = wh.del;
    it._poNumber = "PO-DEMO-0016";
  });
  await receivePoItems(po16.items, [1]);

  const po17 = await createPo({
    number: "PO-DEMO-0017",
    supplierId: sup.cleanpro,
    warehouseId: wh.kol,
    orderDaysAgo: 40,
    items: [{ sku: "CLN-001", quantity: 300 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received", "closed"],
  });
  po17.items.forEach((it) => {
    it._warehouseId = wh.kol;
    it._poNumber = "PO-DEMO-0017";
  });
  await receivePoItems(po17.items, [1]);

  await createPo({
    number: "PO-DEMO-0018",
    supplierId: sup.sundar,
    warehouseId: wh.mum,
    orderDaysAgo: 8,
    items: [{ sku: "RAW-002", quantity: 25 }],
    statusChain: ["draft", "pending_approval", "cancelled"],
  });
  await createPo({
    number: "PO-DEMO-0019",
    supplierId: sup.bharat,
    warehouseId: wh.blr,
    orderDaysAgo: 6,
    items: [{ sku: "PKG-002", quantity: 20 }],
    statusChain: ["draft", "pending_approval", "approved", "cancelled"],
  });
  await createPo({
    number: "PO-DEMO-0020",
    supplierId: sup.anandFoods,
    warehouseId: wh.kol,
    orderDaysAgo: 1,
    items: [{ sku: "FB-002", quantity: 60 }],
    statusChain: ["draft", "pending_approval"],
  });

  // ---------------------------------------------------------------------
  // Sales orders — multiple per so_status value
  // ---------------------------------------------------------------------
  console.log("\nSales orders:");

  async function nextSoNumber() {
    try {
      return await rpc("next_sales_order_number", { _org_id: ORG_ID });
    } catch {
      return `SO-DEMO-${Date.now().toString(36).toUpperCase()}`;
    }
  }
  async function nextInvoiceNumber() {
    try {
      return await rpc("next_sales_invoice_number", { _org_id: ORG_ID });
    } catch {
      return `INV-DEMO-${Date.now().toString(36).toUpperCase()}`;
    }
  }
  async function nextCreditNoteNumber() {
    try {
      return await rpc("next_credit_note_number", { _org_id: ORG_ID });
    } catch {
      return `CN-DEMO-${Date.now().toString(36).toUpperCase()}`;
    }
  }

  async function createSo({ customerId, warehouseId, orderDaysAgo, items, statusChain }) {
    const customerState = (await get("customers", `id=eq.${customerId}&select=state`))[0].state;
    let subtotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    const itemRows = items.map(({ sku, quantity }) => {
      const p = prod[sku];
      const lineSubtotal = round2(p.price * quantity);
      const split = taxSplit(lineSubtotal, p.tax, customerState, whState[warehouseId]);
      subtotal += lineSubtotal;
      cgst += split.cgst;
      sgst += split.sgst;
      igst += split.igst;
      return { product_id: p.id, quantity, unit_price: p.price, tax_rate: p.tax, ...split };
    });
    subtotal = round2(subtotal);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const total = round2(subtotal + cgst + sgst + igst);
    const number = await nextSoNumber();

    const [so] = await insert("sales_orders", [
      {
        org_id: ORG_ID,
        so_number: number,
        customer_id: customerId,
        warehouse_id: warehouseId,
        order_date: daysAgo(orderDaysAgo),
        status: "draft",
        created_by: ACTOR,
        subtotal,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        total_amount: total,
        expected_fulfillment_date: daysAgo(orderDaysAgo - 5),
      },
    ]);
    const insertedItems = await insert(
      "sales_order_items",
      itemRows.map((row) => ({ org_id: ORG_ID, sales_order_id: so.id, ...row })),
    );

    for (const status of statusChain.slice(1)) {
      if (status === "confirmed") {
        for (const item of insertedItems) {
          await insertMovement(ORG_ID, {
            product_id: item.product_id,
            warehouse_id: warehouseId,
            type: "reserve",
            quantity: item.quantity,
            reference: number,
            notes: "Reserved on order confirmation",
            created_by: ACTOR,
          });
        }
      }
      if (status === "shipped") {
        for (const item of insertedItems) {
          await insertMovement(ORG_ID, {
            product_id: item.product_id,
            warehouse_id: warehouseId,
            type: "unreserve",
            quantity: item.quantity,
            reference: number,
            notes: "Released reservation on shipment",
            created_by: ACTOR,
          });
          await insertMovement(ORG_ID, {
            product_id: item.product_id,
            warehouse_id: warehouseId,
            type: "outbound",
            quantity: item.quantity,
            reference: number,
            notes: "Shipped to customer",
            created_by: ACTOR,
          });
        }
      }
      if (status === "cancelled" && statusChain.includes("confirmed")) {
        for (const item of insertedItems) {
          await insertMovement(ORG_ID, {
            product_id: item.product_id,
            warehouse_id: warehouseId,
            type: "unreserve",
            quantity: item.quantity,
            reference: number,
            notes: "Released reservation on cancellation",
            created_by: ACTOR,
          });
        }
      }
      if (status === "returned") {
        for (const item of insertedItems) {
          await insertMovement(ORG_ID, {
            product_id: item.product_id,
            warehouse_id: warehouseId,
            type: "return",
            quantity: item.quantity,
            reference: number,
            notes: "Customer return",
            created_by: ACTOR,
          });
        }
      }
      await patch("sales_orders", so.id, { status });
    }
    console.log(`  + ${number} (${statusChain[statusChain.length - 1]})`);
    return { so: { ...so, so_number: number }, items: insertedItems, warehouseId, customerId };
  }

  await createSo({
    customerId: cust.chopra,
    warehouseId: wh.mum,
    orderDaysAgo: 1,
    items: [
      { sku: "ELEC-001", quantity: 5 },
      { sku: "MOB-002", quantity: 20 },
    ],
    statusChain: ["draft"],
  });
  await createSo({
    customerId: cust.technova,
    warehouseId: wh.blr,
    orderDaysAgo: 2,
    items: [{ sku: "ELEC-002", quantity: 10 }],
    statusChain: ["draft", "confirmed"],
  });
  await createSo({
    customerId: cust.capital,
    warehouseId: wh.del,
    orderDaysAgo: 3,
    items: [{ sku: "OFF-001", quantity: 20 }],
    statusChain: ["draft", "confirmed", "processing"],
  });
  await createSo({
    customerId: cust.freshmart,
    warehouseId: wh.mum,
    orderDaysAgo: 4,
    items: [{ sku: "PKG-003", quantity: 15 }],
    statusChain: ["draft", "confirmed", "processing", "packed"],
  });
  const so5 = await createSo({
    customerId: cust.priya,
    warehouseId: wh.mum,
    orderDaysAgo: 6,
    items: [{ sku: "MOB-001", quantity: 10 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped"],
  });
  const so6 = await createSo({
    customerId: cust.arjun,
    warehouseId: wh.blr,
    orderDaysAgo: 10,
    items: [{ sku: "MOB-001", quantity: 15 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped", "delivered"],
  });
  await createSo({
    customerId: cust.chopra,
    warehouseId: wh.mum,
    orderDaysAgo: 2,
    items: [{ sku: "OFF-004", quantity: 10 }],
    statusChain: ["draft", "confirmed", "cancelled"],
  });
  const so8 = await createSo({
    customerId: cust.technova,
    warehouseId: wh.mum,
    orderDaysAgo: 15,
    items: [{ sku: "ELEC-004", quantity: 8 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped", "delivered", "returned"],
  });

  // Extra sales orders — more volume per status, exercising the new
  // customers/warehouses/products.
  await createSo({
    customerId: cust.deccan,
    warehouseId: wh.hyd,
    orderDaysAgo: 1,
    items: [{ sku: "FURN-001", quantity: 3 }],
    statusChain: ["draft"],
  });
  await createSo({
    customerId: cust.meera,
    warehouseId: wh.hyd,
    orderDaysAgo: 2,
    items: [
      { sku: "ITP-001", quantity: 2 },
      { sku: "CLN-001", quantity: 5 },
    ],
    statusChain: ["draft"],
  });
  await createSo({
    customerId: cust.eastern,
    warehouseId: wh.kol,
    orderDaysAgo: 3,
    items: [
      { sku: "FB-001", quantity: 50 },
      { sku: "FB-003", quantity: 20 },
    ],
    statusChain: ["draft", "confirmed"],
  });
  const soGlobalOfficeConfirmed = await createSo({
    customerId: cust.globalOffice,
    warehouseId: wh.blr,
    orderDaysAgo: 4,
    items: [
      { sku: "ITP-002", quantity: 10 },
      { sku: "ITP-004", quantity: 15 },
    ],
    statusChain: ["draft", "confirmed"],
  });
  await createSo({
    customerId: cust.rohan,
    warehouseId: wh.del,
    orderDaysAgo: 3,
    items: [{ sku: "OFF-002", quantity: 5 }],
    statusChain: ["draft", "confirmed", "processing"],
  });
  await createSo({
    customerId: cust.sneha,
    warehouseId: wh.mum,
    orderDaysAgo: 4,
    items: [{ sku: "MOB-002", quantity: 8 }],
    statusChain: ["draft", "confirmed", "processing"],
  });
  await createSo({
    customerId: cust.deccan,
    warehouseId: wh.hyd,
    orderDaysAgo: 5,
    items: [{ sku: "FURN-003", quantity: 4 }],
    statusChain: ["draft", "confirmed", "processing", "packed"],
  });
  await createSo({
    customerId: cust.chopra,
    warehouseId: wh.mum,
    orderDaysAgo: 3,
    items: [{ sku: "PKG-003", quantity: 30 }],
    statusChain: ["draft", "confirmed", "processing", "packed"],
  });
  const so9 = await createSo({
    customerId: cust.globalOffice,
    warehouseId: wh.blr,
    orderDaysAgo: 8,
    items: [{ sku: "ITP-003", quantity: 5 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped"],
  });
  const so10 = await createSo({
    customerId: cust.eastern,
    warehouseId: wh.kol,
    orderDaysAgo: 11,
    items: [{ sku: "FB-002", quantity: 25 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped"],
  });
  const so11 = await createSo({
    customerId: cust.deccan,
    warehouseId: wh.hyd,
    orderDaysAgo: 9,
    items: [{ sku: "FURN-002", quantity: 2 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped", "delivered"],
  });
  const so12 = await createSo({
    customerId: cust.meera,
    warehouseId: wh.hyd,
    orderDaysAgo: 7,
    items: [{ sku: "CLN-002", quantity: 10 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped", "delivered"],
  });
  const so13 = await createSo({
    customerId: cust.freshmart,
    warehouseId: wh.mum,
    orderDaysAgo: 6,
    items: [{ sku: "FB-003", quantity: 40 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped", "delivered"],
  });
  await createSo({
    customerId: cust.rohan,
    warehouseId: wh.del,
    orderDaysAgo: 5,
    items: [{ sku: "ITP-001", quantity: 3 }],
    statusChain: ["draft", "confirmed", "cancelled"],
  });
  await createSo({
    customerId: cust.priya,
    warehouseId: wh.mum,
    orderDaysAgo: 3,
    items: [{ sku: "MOB-004", quantity: 5 }],
    statusChain: ["draft", "confirmed", "cancelled"],
  });
  const so16 = await createSo({
    customerId: cust.globalOffice,
    warehouseId: wh.blr,
    orderDaysAgo: 18,
    items: [{ sku: "ITP-004", quantity: 10 }],
    statusChain: ["draft", "confirmed", "processing", "packed", "shipped", "delivered", "returned"],
  });

  // ---------------------------------------------------------------------
  // Sales invoices + credit/debit notes + proforma invoice
  // ---------------------------------------------------------------------
  console.log("\nSales invoices:");

  async function invoiceSo({ so, items, customerId, paymentStatus }) {
    const customer = (await get("customers", `id=eq.${customerId}&select=*`))[0];
    let subtotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    const itemRows = items.map((item) => {
      const split = {
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
      };
      subtotal += item.unit_price * item.quantity;
      cgst += split.cgst_amount;
      sgst += split.sgst_amount;
      igst += split.igst_amount;
      return {
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        hsn_code: Object.values(prod).find((p) => p.id === item.product_id)?.hsn ?? null,
        ...split,
      };
    });
    subtotal = round2(subtotal);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const total = round2(subtotal + cgst + sgst + igst);
    const number = await nextInvoiceNumber();

    const [invoice] = await insert("sales_invoices", [
      {
        org_id: ORG_ID,
        invoice_number: number,
        sales_order_id: so.id,
        customer_id: customerId,
        customer_gstin: customer.gstin,
        invoice_date: so.order_date,
        created_by: ACTOR,
        billing_address: customer.billing_address,
        shipping_address: customer.shipping_address,
        subtotal,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        total_amount: total,
        payment_status: paymentStatus,
      },
    ]);
    await insert(
      "sales_invoice_items",
      itemRows.map((row) => ({ org_id: ORG_ID, invoice_id: invoice.id, ...row })),
    );
    console.log(`  + ${number} for ${so.so_number}`);
    return invoice;
  }

  const invoice5 = await invoiceSo({
    so: so5.so,
    items: so5.items,
    customerId: so5.customerId,
    paymentStatus: "unpaid",
  });
  const invoice6 = await invoiceSo({
    so: so6.so,
    items: so6.items,
    customerId: so6.customerId,
    paymentStatus: "paid",
  });
  const invoice8 = await invoiceSo({
    so: so8.so,
    items: so8.items,
    customerId: so8.customerId,
    paymentStatus: "partial",
  });
  const invoice9 = await invoiceSo({
    so: so9.so,
    items: so9.items,
    customerId: so9.customerId,
    paymentStatus: "paid",
  });
  const invoice10 = await invoiceSo({
    so: so10.so,
    items: so10.items,
    customerId: so10.customerId,
    paymentStatus: "unpaid",
  });
  const invoice11 = await invoiceSo({
    so: so11.so,
    items: so11.items,
    customerId: so11.customerId,
    paymentStatus: "paid",
  });
  const invoice12 = await invoiceSo({
    so: so12.so,
    items: so12.items,
    customerId: so12.customerId,
    paymentStatus: "partial",
  });
  const invoice13 = await invoiceSo({
    so: so13.so,
    items: so13.items,
    customerId: so13.customerId,
    paymentStatus: "paid",
  });
  const invoice16 = await invoiceSo({
    so: so16.so,
    items: so16.items,
    customerId: so16.customerId,
    paymentStatus: "partial",
  });

  console.log("\nCredit / debit notes:");
  {
    const cnNumber = await nextCreditNoteNumber();
    await insert("credit_notes", [
      {
        org_id: ORG_ID,
        credit_note_number: cnNumber,
        sales_invoice_id: invoice8.id,
        created_by: ACTOR,
        is_full: true,
        reason: "Product returned by customer — full refund issued",
        subtotal: invoice8.subtotal,
        cgst_amount: invoice8.cgst_amount,
        sgst_amount: invoice8.sgst_amount,
        igst_amount: invoice8.igst_amount,
        total_amount: invoice8.total_amount,
      },
    ]);
    console.log(`  + ${cnNumber} against ${invoice8.invoice_number} (full refund)`);
  }
  {
    // Partial return: only 4 of the 10 units on invoice16 came back.
    const returnedFraction = 4 / 10;
    const cnSubtotal = round2(invoice16.subtotal * returnedFraction);
    const cnCgst = round2(invoice16.cgst_amount * returnedFraction);
    const cnSgst = round2(invoice16.sgst_amount * returnedFraction);
    const cnIgst = round2(invoice16.igst_amount * returnedFraction);
    const cnNumber = await nextCreditNoteNumber();
    await insert("credit_notes", [
      {
        org_id: ORG_ID,
        credit_note_number: cnNumber,
        sales_invoice_id: invoice16.id,
        created_by: ACTOR,
        is_full: false,
        reason: "4 of 10 units returned by customer — partial refund issued",
        subtotal: cnSubtotal,
        cgst_amount: cnCgst,
        sgst_amount: cnSgst,
        igst_amount: cnIgst,
        total_amount: round2(cnSubtotal + cnCgst + cnSgst + cnIgst),
      },
    ]);
    console.log(`  + ${cnNumber} against ${invoice16.invoice_number} (partial refund)`);
  }
  {
    const dnSubtotal = 150;
    const split = taxSplit(
      dnSubtotal,
      18,
      (await get("customers", `id=eq.${cust.priya}&select=state`))[0].state,
      whState[wh.mum],
    );
    const dnNumber = `DN-DEMO-${Date.now().toString(36).toUpperCase()}`;
    await insert("debit_notes", [
      {
        org_id: ORG_ID,
        debit_note_number: dnNumber,
        sales_invoice_id: invoice5.id,
        created_by: ACTOR,
        reason: "Additional packaging and handling charges billed separately",
        subtotal: dnSubtotal,
        cgst_amount: split.cgst,
        sgst_amount: split.sgst,
        igst_amount: split.igst,
        total_amount: round2(dnSubtotal + split.cgst + split.sgst + split.igst),
      },
    ]);
    console.log(`  + ${dnNumber} against ${invoice5.invoice_number} (extra charges)`);
  }
  {
    const dnSubtotal = 220;
    const split = taxSplit(
      dnSubtotal,
      18,
      (await get("customers", `id=eq.${cust.eastern}&select=state`))[0].state,
      whState[wh.kol],
    );
    const dnNumber = `DN-DEMO-${(Date.now() + 1).toString(36).toUpperCase()}`;
    await insert("debit_notes", [
      {
        org_id: ORG_ID,
        debit_note_number: dnNumber,
        sales_invoice_id: invoice10.id,
        created_by: ACTOR,
        reason: "Late payment interest charged on overdue invoice",
        subtotal: dnSubtotal,
        cgst_amount: split.cgst,
        sgst_amount: split.sgst,
        igst_amount: split.igst,
        total_amount: round2(dnSubtotal + split.cgst + split.sgst + split.igst),
      },
    ]);
    console.log(`  + ${dnNumber} against ${invoice10.invoice_number} (late payment interest)`);
  }

  console.log("\nProforma invoice:");
  {
    const [technovaSo] = await get(
      "sales_orders",
      `org_id=eq.${ORG_ID}&customer_id=eq.${cust.technova}&status=eq.confirmed&select=id,subtotal,cgst_amount,sgst_amount,igst_amount,total_amount,order_date`,
    );
    if (technovaSo) {
      const piNumber = `PI-DEMO-${Date.now().toString(36).toUpperCase()}`;
      await insert("proforma_invoices", [
        {
          org_id: ORG_ID,
          proforma_number: piNumber,
          customer_id: cust.technova,
          sales_order_id: technovaSo.id,
          created_by: ACTOR,
          proforma_date: technovaSo.order_date,
          subtotal: technovaSo.subtotal,
          cgst_amount: technovaSo.cgst_amount,
          sgst_amount: technovaSo.sgst_amount,
          igst_amount: technovaSo.igst_amount,
          total_amount: technovaSo.total_amount,
        },
      ]);
      console.log(`  + ${piNumber} for TechNova Solutions`);
    }
  }
  {
    const so = soGlobalOfficeConfirmed.so;
    const piNumber = `PI-DEMO-${(Date.now() + 1).toString(36).toUpperCase()}`;
    await insert("proforma_invoices", [
      {
        org_id: ORG_ID,
        proforma_number: piNumber,
        customer_id: cust.globalOffice,
        sales_order_id: so.id,
        created_by: ACTOR,
        proforma_date: so.order_date,
        subtotal: so.subtotal,
        cgst_amount: so.cgst_amount,
        sgst_amount: so.sgst_amount,
        igst_amount: so.igst_amount,
        total_amount: so.total_amount,
      },
    ]);
    console.log(`  + ${piNumber} for Global Office Systems`);
  }

  // ---------------------------------------------------------------------
  // Demo e-Way Bill / e-Invoice records (no real GSP calls — clearly fake
  // reference numbers, purely so the UI has something to render).
  // ---------------------------------------------------------------------
  console.log("\nDemo compliance documents:");
  {
    const ewbNumber = `${Date.now()}`.slice(0, 12).padEnd(12, "0");
    await insert("eway_bills", [
      {
        org_id: ORG_ID,
        ewb_number: ewbNumber,
        ewb_date: invoice6.created_at,
        valid_until: daysAgo(-2),
        source_type: "sales_invoice",
        source_id: invoice6.id,
        status: "generated",
        transport_mode: "Road",
        vehicle_number: "KA01AB1234",
        transporter_name: "Speedway Logistics",
        distance_km: 45,
        created_by: ACTOR,
        request_payload: { demo: true, docNo: invoice6.invoice_number },
        response_payload: {
          demo: true,
          ewbNo: ewbNumber,
          note: "Synthetic demo data — not a real e-Way Bill",
        },
      },
    ]);
    console.log(`  + demo e-Way Bill ${ewbNumber} for ${invoice6.invoice_number}`);
  }
  {
    const ewbNumber = `${Date.now() + 1}`.slice(0, 12).padEnd(12, "0");
    await insert("eway_bills", [
      {
        org_id: ORG_ID,
        ewb_number: ewbNumber,
        ewb_date: invoice11.created_at,
        valid_until: daysAgo(-1),
        source_type: "sales_invoice",
        source_id: invoice11.id,
        status: "generated",
        transport_mode: "Road",
        vehicle_number: "TS09CD5678",
        transporter_name: "Deccan Cargo Movers",
        distance_km: 12,
        created_by: ACTOR,
        request_payload: { demo: true, docNo: invoice11.invoice_number },
        response_payload: {
          demo: true,
          ewbNo: ewbNumber,
          note: "Synthetic demo data — not a real e-Way Bill",
        },
      },
    ]);
    console.log(`  + demo e-Way Bill ${ewbNumber} for ${invoice11.invoice_number}`);
  }
  {
    // Expired e-Way Bill: shipped 11 days ago on an invoice that's still unpaid.
    const ewbNumber = `${Date.now() + 2}`.slice(0, 12).padEnd(12, "0");
    await insert("eway_bills", [
      {
        org_id: ORG_ID,
        ewb_number: ewbNumber,
        ewb_date: invoice10.created_at,
        valid_until: daysAgo(3),
        source_type: "sales_invoice",
        source_id: invoice10.id,
        status: "expired",
        transport_mode: "Road",
        vehicle_number: "WB06EF9012",
        transporter_name: "Eastern Freight Carriers",
        distance_km: 8,
        created_by: ACTOR,
        request_payload: { demo: true, docNo: invoice10.invoice_number },
        response_payload: {
          demo: true,
          ewbNo: ewbNumber,
          note: "Synthetic demo data — not a real e-Way Bill",
        },
      },
    ]);
    console.log(`  + demo e-Way Bill ${ewbNumber} for ${invoice10.invoice_number} (expired)`);
  }
  {
    const irn = fakeIrn(`demo-${invoice8.id}`);
    await insert("einvoices", [
      {
        org_id: ORG_ID,
        invoice_id: invoice8.id,
        irn,
        ack_no: `${Date.now()}`.padStart(15, "1"),
        ack_date: new Date().toISOString(),
        qr_code: `demo-irn:${irn}`,
        status: "generated",
        created_by: ACTOR,
        request_payload: { demo: true, docNo: invoice8.invoice_number },
        response_payload: {
          demo: true,
          irn,
          note: "Synthetic demo data — not a real e-Invoice IRN",
        },
      },
    ]);
    console.log(`  + demo e-Invoice IRN for ${invoice8.invoice_number}`);
  }
  {
    const irn = fakeIrn(`demo-${invoice9.id}`);
    await insert("einvoices", [
      {
        org_id: ORG_ID,
        invoice_id: invoice9.id,
        irn,
        ack_no: `${Date.now() + 1}`.padStart(15, "1"),
        ack_date: new Date().toISOString(),
        qr_code: `demo-irn:${irn}`,
        status: "generated",
        created_by: ACTOR,
        request_payload: { demo: true, docNo: invoice9.invoice_number },
        response_payload: {
          demo: true,
          irn,
          note: "Synthetic demo data — not a real e-Invoice IRN",
        },
      },
    ]);
    console.log(`  + demo e-Invoice IRN for ${invoice9.invoice_number}`);
  }
  {
    // Cancelled e-Invoice: generated, then voided (e.g. order details changed after filing).
    const irn = fakeIrn(`demo-${invoice13.id}`);
    await insert("einvoices", [
      {
        org_id: ORG_ID,
        invoice_id: invoice13.id,
        irn,
        ack_no: `${Date.now() + 2}`.padStart(15, "1"),
        ack_date: daysAgo(4),
        qr_code: `demo-irn:${irn}`,
        status: "cancelled",
        cancel_reason: "Data entry error corrected — reissued as a fresh invoice",
        cancelled_at: daysAgo(2),
        created_by: ACTOR,
        request_payload: { demo: true, docNo: invoice13.invoice_number },
        response_payload: {
          demo: true,
          irn,
          note: "Synthetic demo data — not a real e-Invoice IRN",
        },
      },
    ]);
    console.log(`  + demo e-Invoice IRN for ${invoice13.invoice_number} (cancelled)`);
  }

  // ---------------------------------------------------------------------
  // Stock transfers — one per stock_transfer_status value
  // ---------------------------------------------------------------------
  console.log("\nStock transfers:");

  async function createTransfer({ number, sourceId, destId, items, daysAgoOrdered }) {
    const [transfer] = await insert("stock_transfers", [
      {
        org_id: ORG_ID,
        transfer_number: number,
        source_warehouse_id: sourceId,
        destination_warehouse_id: destId,
        status: "draft",
        requested_by: ACTOR,
        created_at: daysAgo(daysAgoOrdered),
      },
    ]);
    const insertedItems = await insert(
      "stock_transfer_items",
      items.map(({ sku, quantity }) => ({
        org_id: ORG_ID,
        stock_transfer_id: transfer.id,
        product_id: prod[sku].id,
        quantity,
      })),
    );
    return { transfer, items: insertedItems };
  }
  async function shipTransfer(transfer, items, sourceId, destId) {
    for (const item of items) {
      await insertMovement(ORG_ID, {
        product_id: item.product_id,
        warehouse_id: sourceId,
        type: "xfer_ship",
        quantity: item.quantity,
        reference: transfer.transfer_number,
        notes: "Shipped on stock transfer",
        created_by: ACTOR,
      });
      await insertMovement(ORG_ID, {
        product_id: item.product_id,
        warehouse_id: destId,
        type: "xfer_arrive",
        quantity: item.quantity,
        reference: transfer.transfer_number,
        notes: "In transit on stock transfer",
        created_by: ACTOR,
      });
    }
    await patch("stock_transfers", transfer.id, {
      status: "in_transit",
      shipped_at: new Date().toISOString(),
    });
  }

  // T1: draft
  await createTransfer({
    number: "ST-DEMO-0001",
    sourceId: wh.mum,
    destId: wh.blr,
    items: [{ sku: "ELEC-004", quantity: 10 }],
    daysAgoOrdered: 1,
  });

  // T2: requested
  {
    const t = await createTransfer({
      number: "ST-DEMO-0002",
      sourceId: wh.mum,
      destId: wh.del,
      items: [{ sku: "OFF-001", quantity: 50 }],
      daysAgoOrdered: 2,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
  }

  // T3: approved
  {
    const t = await createTransfer({
      number: "ST-DEMO-0003",
      sourceId: wh.blr,
      destId: wh.mum,
      items: [{ sku: "MOB-002", quantity: 100 }],
      daysAgoOrdered: 3,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
  }

  // T4: in_transit
  {
    const t = await createTransfer({
      number: "ST-DEMO-0004",
      sourceId: wh.mum,
      destId: wh.blr,
      items: [{ sku: "PKG-003", quantity: 40 }],
      daysAgoOrdered: 2,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await shipTransfer(t.transfer, t.items, wh.mum, wh.blr);
  }

  // T5: received, with a partial receive + damage on one line
  {
    const t = await createTransfer({
      number: "ST-DEMO-0005",
      sourceId: wh.mum,
      destId: wh.blr,
      items: [
        { sku: "PKG-001", quantity: 50 },
        { sku: "ELEC-002", quantity: 30 },
      ],
      daysAgoOrdered: 6,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await shipTransfer(t.transfer, t.items, wh.mum, wh.blr);

    const [pkgItem, elecItem] = t.items;
    await insertMovement(ORG_ID, {
      product_id: pkgItem.product_id,
      warehouse_id: wh.blr,
      type: "xfer_receive",
      quantity: 45,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: ACTOR,
    });
    await insertMovement(ORG_ID, {
      product_id: pkgItem.product_id,
      warehouse_id: wh.blr,
      type: "xfer_receive_damaged",
      quantity: 5,
      reference: t.transfer.transfer_number,
      notes: "Received damaged against stock transfer",
      created_by: ACTOR,
    });
    await patch("stock_transfer_items", pkgItem.id, { received_quantity: 45, damaged_quantity: 5 });
    await insertMovement(ORG_ID, {
      product_id: elecItem.product_id,
      warehouse_id: wh.blr,
      type: "xfer_receive",
      quantity: 30,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: ACTOR,
    });
    await patch("stock_transfer_items", elecItem.id, { received_quantity: 30 });
    await patch("stock_transfers", t.transfer.id, {
      status: "received",
      received_at: new Date().toISOString(),
    });
  }

  // T6: completed
  {
    const t = await createTransfer({
      number: "ST-DEMO-0006",
      sourceId: wh.blr,
      destId: wh.del,
      items: [{ sku: "MOB-001", quantity: 100 }],
      daysAgoOrdered: 12,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await shipTransfer(t.transfer, t.items, wh.blr, wh.del);
    const [item] = t.items;
    await insertMovement(ORG_ID, {
      product_id: item.product_id,
      warehouse_id: wh.del,
      type: "xfer_receive",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: ACTOR,
    });
    await patch("stock_transfer_items", item.id, { received_quantity: item.quantity });
    await patch("stock_transfers", t.transfer.id, {
      status: "received",
      received_at: new Date().toISOString(),
    });
    await patch("stock_transfers", t.transfer.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
  }

  // T7: cancelled while in transit (full reversal)
  {
    const t = await createTransfer({
      number: "ST-DEMO-0007",
      sourceId: wh.mum,
      destId: wh.del,
      items: [{ sku: "OFF-002", quantity: 80 }],
      daysAgoOrdered: 4,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await shipTransfer(t.transfer, t.items, wh.mum, wh.del);
    const [item] = t.items;
    await insertMovement(ORG_ID, {
      product_id: item.product_id,
      warehouse_id: wh.mum,
      type: "xfer_cancel_ship",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Stock transfer cancelled in transit",
      created_by: ACTOR,
    });
    await insertMovement(ORG_ID, {
      product_id: item.product_id,
      warehouse_id: wh.del,
      type: "xfer_cancel_arrive",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Stock transfer cancelled in transit",
      created_by: ACTOR,
    });
    await patch("stock_transfers", t.transfer.id, {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    });
  }
  // T8: draft
  await createTransfer({
    number: "ST-DEMO-0008",
    sourceId: wh.hyd,
    destId: wh.mum,
    items: [{ sku: "FURN-001", quantity: 5 }],
    daysAgoOrdered: 1,
  });

  // T9: requested
  {
    const t = await createTransfer({
      number: "ST-DEMO-0009",
      sourceId: wh.blr,
      destId: wh.kol,
      items: [{ sku: "ITP-002", quantity: 20 }],
      daysAgoOrdered: 2,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
  }

  // T10: approved
  {
    const t = await createTransfer({
      number: "ST-DEMO-0010",
      sourceId: wh.kol,
      destId: wh.del,
      items: [{ sku: "FB-001", quantity: 100 }],
      daysAgoOrdered: 3,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
  }

  // T11: in_transit
  {
    const t = await createTransfer({
      number: "ST-DEMO-0011",
      sourceId: wh.mum,
      destId: wh.hyd,
      items: [{ sku: "MOB-004", quantity: 40 }],
      daysAgoOrdered: 2,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await shipTransfer(t.transfer, t.items, wh.mum, wh.hyd);
  }

  // T12: received
  {
    const t = await createTransfer({
      number: "ST-DEMO-0012",
      sourceId: wh.hyd,
      destId: wh.blr,
      items: [{ sku: "FURN-003", quantity: 8 }],
      daysAgoOrdered: 7,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await shipTransfer(t.transfer, t.items, wh.hyd, wh.blr);
    const [item] = t.items;
    await insertMovement(ORG_ID, {
      product_id: item.product_id,
      warehouse_id: wh.blr,
      type: "xfer_receive",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: ACTOR,
    });
    await patch("stock_transfer_items", item.id, { received_quantity: item.quantity });
    await patch("stock_transfers", t.transfer.id, {
      status: "received",
      received_at: new Date().toISOString(),
    });
  }

  // T13: completed
  {
    const t = await createTransfer({
      number: "ST-DEMO-0013",
      sourceId: wh.kol,
      destId: wh.mum,
      items: [{ sku: "CLN-001", quantity: 150 }],
      daysAgoOrdered: 14,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await shipTransfer(t.transfer, t.items, wh.kol, wh.mum);
    const [item] = t.items;
    await insertMovement(ORG_ID, {
      product_id: item.product_id,
      warehouse_id: wh.mum,
      type: "xfer_receive",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: ACTOR,
    });
    await patch("stock_transfer_items", item.id, { received_quantity: item.quantity });
    await patch("stock_transfers", t.transfer.id, {
      status: "received",
      received_at: new Date().toISOString(),
    });
    await patch("stock_transfers", t.transfer.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
  }

  // T14: cancelled before shipping (a different use case from T7's in-transit
  // reversal — here nothing has moved yet, so no reversal movements needed).
  {
    const t = await createTransfer({
      number: "ST-DEMO-0014",
      sourceId: wh.del,
      destId: wh.kol,
      items: [{ sku: "OFF-003", quantity: 10 }],
      daysAgoOrdered: 5,
    });
    await patch("stock_transfers", t.transfer.id, { status: "requested" });
    await patch("stock_transfers", t.transfer.id, { status: "approved", approved_by: ACTOR });
    await patch("stock_transfers", t.transfer.id, {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    });
  }

  console.log(
    "  + ST-DEMO-0001..0014 across draft/requested/approved/in_transit/received/completed/cancelled",
  );

  // ---------------------------------------------------------------------
  // Alerts for the deliberately low/out-of-stock products above
  // ---------------------------------------------------------------------
  console.log("\nAlerts:");
  const alertDefs = [
    {
      sku: "ELEC-001",
      title: "Low stock: Wireless Bluetooth Earbuds at Mumbai Central Warehouse",
      severity: "warning",
      action: "Reorder from Shree Electronics Distributors (lead time 7 days)",
    },
    {
      sku: "ELEC-003",
      title: "Low stock: Portable Power Bank 10000mAh at Mumbai Central Warehouse",
      severity: "warning",
      action: "Reorder from Shree Electronics Distributors (lead time 7 days)",
    },
    {
      sku: "OFF-003",
      title: "Low stock: Stapler Heavy Duty at Mumbai Central Warehouse",
      severity: "warning",
      action: "Reorder from National Office Traders (lead time 4 days)",
    },
    {
      sku: "PKG-002",
      title: "Low stock: Bubble Wrap Roll 50m at Mumbai Central Warehouse",
      severity: "warning",
      action: "PO-DEMO-0004 already sent to Bharat Packaging Solutions",
    },
    {
      sku: "RAW-002",
      title: "Out of stock: Steel Sheet 2mm at Mumbai Central Warehouse",
      severity: "critical",
      action: "Reorder urgently from Sundar Raw Materials Pvt Ltd (lead time 10 days)",
    },
    {
      sku: "ITP-003",
      title: "Low stock: 24-inch Full HD Monitor at Bengaluru Fulfillment Center",
      severity: "warning",
      action: "Reorder from ByteLink IT Peripherals for Bengaluru (lead time 8 days)",
    },
    {
      sku: "CLN-003",
      title: "Low stock: Floor Cleaner 5L at Kolkata Eastern Warehouse",
      severity: "warning",
      action: "PO-DEMO-0010 already pending approval with CleanPro Chemicals",
    },
    {
      sku: "FURN-002",
      title: "Low stock: Adjustable Standing Desk at Hyderabad Distribution Center",
      severity: "warning",
      action: "Reorder from Trident Furniture Works for Hyderabad (lead time 15 days)",
    },
  ];
  for (const a of alertDefs) {
    await insert("alerts", [
      {
        org_id: ORG_ID,
        type: "low_stock",
        severity: a.severity,
        status: "open",
        title: a.title,
        description: `${prod[a.sku].name} (${a.sku}) has fallen at or below its reorder point.`,
        entity_type: "product",
        entity_id: prod[a.sku].id,
        recommended_action: a.action,
      },
    ]);
  }
  console.log(`  + ${alertDefs.length} low-stock/stockout alerts`);

  // ---------------------------------------------------------------------
  // A couple of real UPDATEs so the audit_log has organization-level rows
  // too (order/transfer status changes above already produced plenty).
  // ---------------------------------------------------------------------
  if (!org.industry) {
    await patch("organizations", ORG_ID, {
      industry: "Consumer Electronics & Office Supplies Distribution",
    });
    console.log("\nSet organization industry (also exercises the audit_log trigger).");
  }

  console.log("\nDone. Demo data seeded successfully.");
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message);
  process.exit(1);
});
