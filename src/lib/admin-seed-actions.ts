// Platform-admin demo seed/delete tool -- server functions backing the
// /admin page. This is a from-scratch TypeScript port of the dataset
// design in scripts/seed-demo-data.mjs (see that file's header for the
// full rationale on why these write tables directly instead of the app's
// workflow RPCs), adapted in three ways for the admin UI:
//
// 1. It runs against a service-role client from a server function instead
//    of a standalone script, so it can be triggered from a page instead of
//    a terminal.
// 2. Every row it inserts into a business table is also recorded into
//    demo_seed_records under a fresh demo_seed_batches row, so
//    adminDeleteSeedData can remove exactly what this tool created --
//    never anything the business's real users added themselves.
// 3. PO/ST numbers get a short random per-run tag so the same org can be
//    safely seeded more than once without a unique-number conflict (the
//    RPC-numbered SO/invoice/credit-note sequences don't need this, since
//    they draw from the org's own counter).
//
// requirePlatformAdmin gates every handler here -- see src/lib/admin-auth.ts.
import { createServerFn } from "@tanstack/react-start";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin-auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any;
type Track = { table_name: string; record_id: string }[];

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Same-state -> CGST+SGST split; cross-state -> IGST. Mirrors src/lib/gst.ts.
function taxSplit(
  taxableValue: number,
  rate: number,
  partyState: string | null,
  warehouseState: string | null,
) {
  const totalTax = round2((taxableValue * rate) / 100);
  if (partyState && warehouseState && partyState === warehouseState) {
    const half = round2(totalTax / 2);
    return { cgst: half, sgst: round2(totalTax - half), igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: totalTax };
}

function fakeIrn(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function runTag() {
  return randomBytes(3).toString("hex");
}

async function insertTracked(
  db: AdminDb,
  table: string,
  rows: Record<string, unknown>[],
  track: Track,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const { data, error } = await db.from(table).insert(rows).select();
  if (error) throw new Error(`insert ${table} failed: ${error.message}`);
  for (const row of data ?? []) track.push({ table_name: table, record_id: row.id });
  return data ?? [];
}

async function findOrCreate(
  db: AdminDb,
  table: string,
  match: Record<string, string>,
  row: Record<string, unknown>,
  track: Track,
): Promise<string> {
  let query = db.from(table).select("id");
  for (const [k, v] of Object.entries(match)) query = query.eq(k, v);
  const { data: existing, error } = await query;
  if (error) throw new Error(`lookup ${table} failed: ${error.message}`);
  if (existing?.length) return existing[0].id;
  const [created] = await insertTracked(db, table, [row], track);
  return created.id;
}

async function patchRow(db: AdminDb, table: string, id: string, body: Record<string, unknown>) {
  const { error } = await db.from(table).update(body).eq("id", id);
  if (error) throw new Error(`update ${table} failed: ${error.message}`);
}

async function insertMovement(
  db: AdminDb,
  track: Track,
  orgId: string,
  opts: {
    product_id: string;
    warehouse_id: string;
    type: string;
    quantity: number;
    reference?: string;
    notes?: string;
    created_by: string;
  },
) {
  await insertTracked(
    db,
    "stock_movements",
    [
      {
        org_id: orgId,
        product_id: opts.product_id,
        warehouse_id: opts.warehouse_id,
        type: opts.type,
        quantity: opts.quantity,
        reference: opts.reference ?? null,
        notes: opts.notes ?? null,
        created_by: opts.created_by,
      },
    ],
    track,
  );
}

async function flushTrack(db: AdminDb, batchId: string, track: Track) {
  if (!track.length) return;
  const rows = track.splice(0, track.length).map((r) => ({ batch_id: batchId, ...r }));
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from("demo_seed_records").insert(chunk);
    if (error) throw new Error(`failed to record seeded rows: ${error.message}`);
  }
}

type Prod = {
  id: string;
  sku: string;
  hsn: string;
  price: number;
  cost: number;
  tax: number;
};

async function seedOrg(
  db: AdminDb,
  orgId: string,
  actor: string,
  track: Track,
  flush: () => Promise<void>,
) {
  const tag = runTag();

  // -- Categories ----------------------------------------------------------
  const catId = {
    electronics: "",
    mobileAccessories: "",
    office: "",
    packaging: "",
    rawMaterials: "",
  };
  catId.electronics = await findOrCreate(
    db,
    "categories",
    { org_id: orgId, name: "Electronics" },
    { org_id: orgId, name: "Electronics", description: "Consumer electronics and gadgets" },
    track,
  );
  catId.mobileAccessories = await findOrCreate(
    db,
    "categories",
    { org_id: orgId, name: "Mobile Accessories" },
    {
      org_id: orgId,
      name: "Mobile Accessories",
      description: "Cases, chargers and add-ons for phones",
      parent_id: catId.electronics,
    },
    track,
  );
  catId.office = await findOrCreate(
    db,
    "categories",
    { org_id: orgId, name: "Office Supplies" },
    { org_id: orgId, name: "Office Supplies", description: "Stationery and office consumables" },
    track,
  );
  catId.packaging = await findOrCreate(
    db,
    "categories",
    { org_id: orgId, name: "Packaging Materials" },
    {
      org_id: orgId,
      name: "Packaging Materials",
      description: "Boxes, wrap and tape for shipping",
    },
    track,
  );
  catId.rawMaterials = await findOrCreate(
    db,
    "categories",
    { org_id: orgId, name: "Raw Materials" },
    { org_id: orgId, name: "Raw Materials", description: "Inputs used in light assembly" },
    track,
  );
  await flush();

  // -- Warehouses ------------------------------------------------------------
  const wh = { mum: "", blr: "", del: "" };
  wh.mum = await findOrCreate(
    db,
    "warehouses",
    { org_id: orgId, code: "MUM-WH1" },
    {
      org_id: orgId,
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
    track,
  );
  wh.blr = await findOrCreate(
    db,
    "warehouses",
    { org_id: orgId, code: "BLR-WH1" },
    {
      org_id: orgId,
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
    track,
  );
  wh.del = await findOrCreate(
    db,
    "warehouses",
    { org_id: orgId, code: "DEL-WH1" },
    {
      org_id: orgId,
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
    track,
  );
  const whState: Record<string, string> = {
    [wh.mum]: "Maharashtra",
    [wh.blr]: "Karnataka",
    [wh.del]: "Delhi",
  };
  await flush();

  // -- Suppliers -------------------------------------------------------------
  const sup = { shree: "", bharat: "", national: "", sundar: "", global: "" };
  sup.shree = await findOrCreate(
    db,
    "suppliers",
    { org_id: orgId, code: "SUP-SHR01" },
    {
      org_id: orgId,
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
    track,
  );
  sup.bharat = await findOrCreate(
    db,
    "suppliers",
    { org_id: orgId, code: "SUP-BHR01" },
    {
      org_id: orgId,
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
    track,
  );
  sup.national = await findOrCreate(
    db,
    "suppliers",
    { org_id: orgId, code: "SUP-NAT01" },
    {
      org_id: orgId,
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
    track,
  );
  sup.sundar = await findOrCreate(
    db,
    "suppliers",
    { org_id: orgId, code: "SUP-SUN01" },
    {
      org_id: orgId,
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
    track,
  );
  sup.global = await findOrCreate(
    db,
    "suppliers",
    { org_id: orgId, code: "SUP-GLB01" },
    {
      org_id: orgId,
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
    track,
  );
  await flush();

  // -- Customers -------------------------------------------------------------
  const cust = {
    chopra: "",
    technova: "",
    capital: "",
    priya: "",
    arjun: "",
    freshmart: "",
  };
  cust.chopra = await findOrCreate(
    db,
    "customers",
    { org_id: orgId, name: "Chopra Retail Mart" },
    {
      org_id: orgId,
      name: "Chopra Retail Mart",
      email: "purchase@chopraretail.example.in",
      phone: "+91 98200 12121",
      gstin: "27AAWFC6789F6Z0",
      state: "Maharashtra",
      billing_address: "Shop 4, Linking Road, Mumbai, Maharashtra 400050",
      shipping_address: "Shop 4, Linking Road, Mumbai, Maharashtra 400050",
    },
    track,
  );
  cust.technova = await findOrCreate(
    db,
    "customers",
    { org_id: orgId, name: "TechNova Solutions" },
    {
      org_id: orgId,
      name: "TechNova Solutions",
      email: "accounts@technova.example.in",
      phone: "+91 98450 23232",
      gstin: "29AABCT7890G7Z1",
      state: "Karnataka",
      billing_address: "4th Floor, Bagmane Tech Park, Bengaluru, Karnataka 560093",
      shipping_address: "4th Floor, Bagmane Tech Park, Bengaluru, Karnataka 560093",
    },
    track,
  );
  cust.capital = await findOrCreate(
    db,
    "customers",
    { org_id: orgId, name: "Capital Traders" },
    {
      org_id: orgId,
      name: "Capital Traders",
      email: "buying@capitaltraders.example.in",
      phone: "+91 98110 34343",
      gstin: "07AABFC8901H8Z2",
      state: "Delhi",
      billing_address: "B-22, Nehru Place, New Delhi, Delhi 110019",
      shipping_address: "B-22, Nehru Place, New Delhi, Delhi 110019",
    },
    track,
  );
  cust.priya = await findOrCreate(
    db,
    "customers",
    { org_id: orgId, name: "Priya Sharma" },
    {
      org_id: orgId,
      name: "Priya Sharma",
      email: "priya.sharma@example.in",
      phone: "+91 98220 45454",
      state: "Maharashtra",
      billing_address: "Flat 302, Sunrise Apartments, Andheri East, Mumbai, Maharashtra 400069",
      shipping_address: "Flat 302, Sunrise Apartments, Andheri East, Mumbai, Maharashtra 400069",
    },
    track,
  );
  cust.arjun = await findOrCreate(
    db,
    "customers",
    { org_id: orgId, name: "Arjun Mehta" },
    {
      org_id: orgId,
      name: "Arjun Mehta",
      email: "arjun.mehta@example.in",
      phone: "+91 98860 56565",
      state: "Karnataka",
      billing_address: "12, Indiranagar 1st Stage, Bengaluru, Karnataka 560038",
      shipping_address: "12, Indiranagar 1st Stage, Bengaluru, Karnataka 560038",
    },
    track,
  );
  cust.freshmart = await findOrCreate(
    db,
    "customers",
    { org_id: orgId, name: "Fresh Mart Supermarket" },
    {
      org_id: orgId,
      name: "Fresh Mart Supermarket",
      email: "supply@freshmart.example.in",
      phone: "+91 98200 67676",
      gstin: "27AADFF9012I9Z3",
      state: "Maharashtra",
      billing_address: "Ground Floor, Powai Plaza, Mumbai, Maharashtra 400076",
      shipping_address: "Ground Floor, Powai Plaza, Mumbai, Maharashtra 400076",
    },
    track,
  );
  await flush();

  // -- Products ----------------------------------------------------------
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
  ];
  const prod: Record<string, Prod> = {};
  for (const p of productDefs) {
    const id = await findOrCreate(
      db,
      "products",
      { org_id: orgId, sku: p.sku },
      {
        org_id: orgId,
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
      track,
    );
    prod[p.sku] = { id, sku: p.sku, hsn: p.hsn, price: p.price, cost: p.cost, tax: p.tax };
  }
  function getProd(sku: string): Prod {
    const p = getProd(sku);
    if (!p) throw new Error(`Unknown demo product sku: ${sku}`);
    return p;
  }
  await flush();

  // -- Opening stock -------------------------------------------------------
  const opening: [string, string, number][] = [
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
    ["PKG-002", wh.mum, 5],
    ["PKG-003", wh.mum, 120],
    ["RAW-001", wh.mum, 45],
    // RAW-002 deliberately left with zero opening stock at MUM to demo a stockout alert.
  ];
  for (const [sku, warehouse_id, quantity] of opening) {
    await insertMovement(db, track, orgId, {
      product_id: getProd(sku).id,
      warehouse_id,
      type: "inbound",
      quantity,
      notes: "Opening stock balance",
      created_by: actor,
    });
  }
  await flush();

  // -- Purchase orders -- one per po_status value ---------------------------
  type PoItem = { id: string; product_id: string; quantity: number };
  async function createPo(opts: {
    number: string;
    supplierId: string;
    warehouseId: string;
    orderDaysAgo: number;
    items: { sku: string; quantity: number }[];
    statusChain: string[];
  }) {
    const { data: supplierRows } = await db
      .from("suppliers")
      .select("state")
      .eq("id", opts.supplierId);
    const supplierState = supplierRows?.[0]?.state ?? null;
    let subtotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    const itemRows = opts.items.map(({ sku, quantity }) => {
      const p = getProd(sku);
      const lineSubtotal = round2(p.cost * quantity);
      const split = taxSplit(lineSubtotal, p.tax, supplierState, whState[opts.warehouseId] ?? null);
      subtotal += lineSubtotal;
      cgst += split.cgst;
      sgst += split.sgst;
      igst += split.igst;
      return {
        product_id: p.id,
        quantity,
        unit_cost: p.cost,
        tax_rate: p.tax,
        cgst_amount: split.cgst,
        sgst_amount: split.sgst,
        igst_amount: split.igst,
      };
    });
    subtotal = round2(subtotal);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const total = round2(subtotal + cgst + sgst + igst);

    const [po] = await insertTracked(
      db,
      "purchase_orders",
      [
        {
          org_id: orgId,
          po_number: opts.number,
          supplier_id: opts.supplierId,
          warehouse_id: opts.warehouseId,
          order_date: daysAgo(opts.orderDaysAgo),
          status: "draft",
          created_by: actor,
          subtotal,
          cgst_amount: cgst,
          sgst_amount: sgst,
          igst_amount: igst,
          tax_amount: round2(cgst + sgst + igst),
          total_amount: total,
          expected_delivery_date: daysAgo(opts.orderDaysAgo - 10),
        },
      ],
      track,
    );
    const insertedItems: PoItem[] = await insertTracked(
      db,
      "purchase_order_items",
      itemRows.map((row) => ({ org_id: orgId, purchase_order_id: po.id, ...row })),
      track,
    );

    for (const status of opts.statusChain.slice(1)) {
      await patchRow(db, "purchase_orders", po.id, { status });
    }
    return { po, items: insertedItems };
  }

  async function receivePoItems(
    poItems: (PoItem & { _warehouseId: string; _poNumber: string })[],
    fractions: number[],
  ) {
    for (let i = 0; i < poItems.length; i++) {
      const item = poItems[i];
      if (!item) continue;
      const fraction = fractions[i] ?? 1;
      if (fraction <= 0) continue;
      const receivedQty = round2(item.quantity * fraction);
      await insertMovement(db, track, orgId, {
        product_id: item.product_id,
        warehouse_id: item._warehouseId,
        type: "inbound",
        quantity: receivedQty,
        reference: item._poNumber,
        notes: "Received against purchase order",
        created_by: actor,
      });
      await patchRow(db, "purchase_order_items", item.id, { received_quantity: receivedQty });
    }
  }

  await createPo({
    number: `PO-DEMO-${tag}-0001`,
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
    number: `PO-DEMO-${tag}-0002`,
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
    number: `PO-DEMO-${tag}-0003`,
    supplierId: sup.shree,
    warehouseId: wh.mum,
    orderDaysAgo: 7,
    items: [{ sku: "ELEC-002", quantity: 100 }],
    statusChain: ["draft", "pending_approval", "approved"],
  });
  await createPo({
    number: `PO-DEMO-${tag}-0004`,
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
    number: `PO-DEMO-${tag}-0005`,
    supplierId: sup.sundar,
    warehouseId: wh.mum,
    orderDaysAgo: 14,
    items: [{ sku: "RAW-001", quantity: 40 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "partially_received"],
  });
  await receivePoItems(
    po5.items.map((it) => ({ ...it, _warehouseId: wh.mum, _poNumber: `PO-DEMO-${tag}-0005` })),
    [0.5],
  );

  const po6 = await createPo({
    number: `PO-DEMO-${tag}-0006`,
    supplierId: sup.shree,
    warehouseId: wh.del,
    orderDaysAgo: 20,
    items: [{ sku: "ELEC-003", quantity: 60 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received"],
  });
  await receivePoItems(
    po6.items.map((it) => ({ ...it, _warehouseId: wh.del, _poNumber: `PO-DEMO-${tag}-0006` })),
    [1],
  );

  const po7 = await createPo({
    number: `PO-DEMO-${tag}-0007`,
    supplierId: sup.national,
    warehouseId: wh.mum,
    orderDaysAgo: 30,
    items: [{ sku: "OFF-001", quantity: 300 }],
    statusChain: ["draft", "pending_approval", "approved", "sent", "received", "closed"],
  });
  await receivePoItems(
    po7.items.map((it) => ({ ...it, _warehouseId: wh.mum, _poNumber: `PO-DEMO-${tag}-0007` })),
    [1],
  );

  await createPo({
    number: `PO-DEMO-${tag}-0008`,
    supplierId: sup.bharat,
    warehouseId: wh.blr,
    orderDaysAgo: 4,
    items: [{ sku: "PKG-001", quantity: 500 }],
    statusChain: ["draft", "pending_approval", "cancelled"],
  });
  await flush();

  // -- Sales orders -- one per so_status value ------------------------------
  type SoItem = {
    id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    tax_rate: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
  };
  type So = {
    id: string;
    so_number: string;
    order_date: string;
    subtotal: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_amount: number;
  };

  async function nextSoNumber() {
    const { data, error } = await db.rpc("next_sales_order_number", { _org_id: orgId });
    if (error || !data) return `SO-DEMO-${tag}-${Date.now().toString(36).toUpperCase()}`;
    return data as string;
  }
  async function nextInvoiceNumber() {
    const { data, error } = await db.rpc("next_sales_invoice_number", { _org_id: orgId });
    if (error || !data) return `INV-DEMO-${tag}-${Date.now().toString(36).toUpperCase()}`;
    return data as string;
  }
  async function nextCreditNoteNumber() {
    const { data, error } = await db.rpc("next_credit_note_number", { _org_id: orgId });
    if (error || !data) return `CN-DEMO-${tag}-${Date.now().toString(36).toUpperCase()}`;
    return data as string;
  }

  async function createSo(opts: {
    customerId: string;
    warehouseId: string;
    orderDaysAgo: number;
    items: { sku: string; quantity: number }[];
    statusChain: string[];
  }): Promise<{ so: So; items: SoItem[]; warehouseId: string; customerId: string }> {
    const { data: customerRows } = await db
      .from("customers")
      .select("state")
      .eq("id", opts.customerId);
    const customerState = customerRows?.[0]?.state ?? null;
    let subtotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    const itemRows = opts.items.map(({ sku, quantity }) => {
      const p = getProd(sku);
      const lineSubtotal = round2(p.price * quantity);
      const split = taxSplit(lineSubtotal, p.tax, customerState, whState[opts.warehouseId] ?? null);
      subtotal += lineSubtotal;
      cgst += split.cgst;
      sgst += split.sgst;
      igst += split.igst;
      return {
        product_id: p.id,
        quantity,
        unit_price: p.price,
        tax_rate: p.tax,
        cgst_amount: split.cgst,
        sgst_amount: split.sgst,
        igst_amount: split.igst,
      };
    });
    subtotal = round2(subtotal);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const total = round2(subtotal + cgst + sgst + igst);
    const number = await nextSoNumber();

    const [so] = await insertTracked(
      db,
      "sales_orders",
      [
        {
          org_id: orgId,
          so_number: number,
          customer_id: opts.customerId,
          warehouse_id: opts.warehouseId,
          order_date: daysAgo(opts.orderDaysAgo),
          status: "draft",
          created_by: actor,
          subtotal,
          cgst_amount: cgst,
          sgst_amount: sgst,
          igst_amount: igst,
          total_amount: total,
          expected_fulfillment_date: daysAgo(opts.orderDaysAgo - 5),
        },
      ],
      track,
    );
    const insertedItems: SoItem[] = await insertTracked(
      db,
      "sales_order_items",
      itemRows.map((row) => ({ org_id: orgId, sales_order_id: so.id, ...row })),
      track,
    );

    for (const status of opts.statusChain.slice(1)) {
      if (status === "confirmed") {
        for (const item of insertedItems) {
          await insertMovement(db, track, orgId, {
            product_id: item.product_id,
            warehouse_id: opts.warehouseId,
            type: "reserve",
            quantity: item.quantity,
            reference: number,
            notes: "Reserved on order confirmation",
            created_by: actor,
          });
        }
      }
      if (status === "shipped") {
        for (const item of insertedItems) {
          await insertMovement(db, track, orgId, {
            product_id: item.product_id,
            warehouse_id: opts.warehouseId,
            type: "unreserve",
            quantity: item.quantity,
            reference: number,
            notes: "Released reservation on shipment",
            created_by: actor,
          });
          await insertMovement(db, track, orgId, {
            product_id: item.product_id,
            warehouse_id: opts.warehouseId,
            type: "outbound",
            quantity: item.quantity,
            reference: number,
            notes: "Shipped to customer",
            created_by: actor,
          });
        }
      }
      if (status === "cancelled" && opts.statusChain.includes("confirmed")) {
        for (const item of insertedItems) {
          await insertMovement(db, track, orgId, {
            product_id: item.product_id,
            warehouse_id: opts.warehouseId,
            type: "unreserve",
            quantity: item.quantity,
            reference: number,
            notes: "Released reservation on cancellation",
            created_by: actor,
          });
        }
      }
      if (status === "returned") {
        for (const item of insertedItems) {
          await insertMovement(db, track, orgId, {
            product_id: item.product_id,
            warehouse_id: opts.warehouseId,
            type: "return",
            quantity: item.quantity,
            reference: number,
            notes: "Customer return",
            created_by: actor,
          });
        }
      }
      await patchRow(db, "sales_orders", so.id, { status });
    }
    return {
      so: { ...so, so_number: number },
      items: insertedItems,
      warehouseId: opts.warehouseId,
      customerId: opts.customerId,
    };
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
  await flush();

  // -- Sales invoices + credit/debit notes + proforma invoice ---------------
  async function invoiceSo(opts: {
    so: So;
    items: SoItem[];
    customerId: string;
    paymentStatus: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<any> {
    const { data: customerRows } = await db.from("customers").select("*").eq("id", opts.customerId);
    const customer = customerRows?.[0];
    let subtotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    const itemRows = opts.items.map((item) => {
      subtotal += item.unit_price * item.quantity;
      cgst += item.cgst_amount;
      sgst += item.sgst_amount;
      igst += item.igst_amount;
      const hsn = Object.values(prod).find((p) => p.id === item.product_id)?.hsn ?? null;
      return {
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        hsn_code: hsn,
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
      };
    });
    subtotal = round2(subtotal);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const total = round2(subtotal + cgst + sgst + igst);
    const number = await nextInvoiceNumber();

    const [invoice] = await insertTracked(
      db,
      "sales_invoices",
      [
        {
          org_id: orgId,
          invoice_number: number,
          sales_order_id: opts.so.id,
          customer_id: opts.customerId,
          customer_gstin: customer?.gstin ?? null,
          invoice_date: opts.so.order_date,
          created_by: actor,
          billing_address: customer?.billing_address ?? null,
          shipping_address: customer?.shipping_address ?? null,
          subtotal,
          cgst_amount: cgst,
          sgst_amount: sgst,
          igst_amount: igst,
          total_amount: total,
          payment_status: opts.paymentStatus,
        },
      ],
      track,
    );
    await insertTracked(
      db,
      "sales_invoice_items",
      itemRows.map((row) => ({ org_id: orgId, invoice_id: invoice.id, ...row })),
      track,
    );
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

  {
    const cnNumber = await nextCreditNoteNumber();
    await insertTracked(
      db,
      "credit_notes",
      [
        {
          org_id: orgId,
          credit_note_number: cnNumber,
          sales_invoice_id: invoice8.id,
          created_by: actor,
          is_full: true,
          reason: "Product returned by customer — full refund issued",
          subtotal: invoice8.subtotal,
          cgst_amount: invoice8.cgst_amount,
          sgst_amount: invoice8.sgst_amount,
          igst_amount: invoice8.igst_amount,
          total_amount: invoice8.total_amount,
        },
      ],
      track,
    );
  }
  {
    const dnSubtotal = 150;
    const { data: priyaRows } = await db.from("customers").select("state").eq("id", cust.priya);
    const split = taxSplit(dnSubtotal, 18, priyaRows?.[0]?.state ?? null, whState[wh.mum] ?? null);
    const dnNumber = `DN-DEMO-${tag}-${Date.now().toString(36).toUpperCase()}`;
    await insertTracked(
      db,
      "debit_notes",
      [
        {
          org_id: orgId,
          debit_note_number: dnNumber,
          sales_invoice_id: invoice5.id,
          created_by: actor,
          reason: "Additional packaging and handling charges billed separately",
          subtotal: dnSubtotal,
          cgst_amount: split.cgst,
          sgst_amount: split.sgst,
          igst_amount: split.igst,
          total_amount: round2(dnSubtotal + split.cgst + split.sgst + split.igst),
        },
      ],
      track,
    );
  }

  {
    const { data: technovaSoRows } = await db
      .from("sales_orders")
      .select("id, subtotal, cgst_amount, sgst_amount, igst_amount, total_amount, order_date")
      .eq("org_id", orgId)
      .eq("customer_id", cust.technova)
      .eq("status", "confirmed");
    const technovaSo = technovaSoRows?.[0];
    if (technovaSo) {
      const piNumber = `PI-DEMO-${tag}-${Date.now().toString(36).toUpperCase()}`;
      await insertTracked(
        db,
        "proforma_invoices",
        [
          {
            org_id: orgId,
            proforma_number: piNumber,
            customer_id: cust.technova,
            sales_order_id: technovaSo.id,
            created_by: actor,
            proforma_date: technovaSo.order_date,
            subtotal: technovaSo.subtotal,
            cgst_amount: technovaSo.cgst_amount,
            sgst_amount: technovaSo.sgst_amount,
            igst_amount: technovaSo.igst_amount,
            total_amount: technovaSo.total_amount,
          },
        ],
        track,
      );
    }
  }
  await flush();

  // -- Demo e-Way Bill / e-Invoice (no real GSP calls) -----------------------
  {
    const ewbNumber = `${Date.now()}`.slice(0, 12).padEnd(12, "0");
    await insertTracked(
      db,
      "eway_bills",
      [
        {
          org_id: orgId,
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
          created_by: actor,
          request_payload: { demo: true, docNo: invoice6.invoice_number },
          response_payload: {
            demo: true,
            ewbNo: ewbNumber,
            note: "Synthetic demo data — not a real e-Way Bill",
          },
        },
      ],
      track,
    );
  }
  {
    const irn = fakeIrn(`demo-${invoice8.id}`);
    await insertTracked(
      db,
      "einvoices",
      [
        {
          org_id: orgId,
          invoice_id: invoice8.id,
          irn,
          ack_no: `${Date.now()}`.padStart(15, "1"),
          ack_date: new Date().toISOString(),
          qr_code: `demo-irn:${irn}`,
          status: "generated",
          created_by: actor,
          request_payload: { demo: true, docNo: invoice8.invoice_number },
          response_payload: {
            demo: true,
            irn,
            note: "Synthetic demo data — not a real e-Invoice IRN",
          },
        },
      ],
      track,
    );
  }
  await flush();

  // -- Stock transfers -- one per stock_transfer_status value ---------------
  type TransferItem = { id: string; product_id: string; quantity: number };
  type Transfer = { id: string; transfer_number: string };

  async function createTransfer(opts: {
    number: string;
    sourceId: string;
    destId: string;
    items: { sku: string; quantity: number }[];
    daysAgoOrdered: number;
  }): Promise<{ transfer: Transfer; items: TransferItem[] }> {
    const [transfer] = await insertTracked(
      db,
      "stock_transfers",
      [
        {
          org_id: orgId,
          transfer_number: opts.number,
          source_warehouse_id: opts.sourceId,
          destination_warehouse_id: opts.destId,
          status: "draft",
          requested_by: actor,
          created_at: daysAgo(opts.daysAgoOrdered),
        },
      ],
      track,
    );
    const insertedItems: TransferItem[] = await insertTracked(
      db,
      "stock_transfer_items",
      opts.items.map(({ sku, quantity }) => ({
        org_id: orgId,
        stock_transfer_id: transfer.id,
        product_id: getProd(sku).id,
        quantity,
      })),
      track,
    );
    return { transfer, items: insertedItems };
  }

  async function shipTransfer(
    transfer: Transfer,
    items: TransferItem[],
    sourceId: string,
    destId: string,
  ) {
    for (const item of items) {
      await insertMovement(db, track, orgId, {
        product_id: item.product_id,
        warehouse_id: sourceId,
        type: "xfer_ship",
        quantity: item.quantity,
        reference: transfer.transfer_number,
        notes: "Shipped on stock transfer",
        created_by: actor,
      });
      await insertMovement(db, track, orgId, {
        product_id: item.product_id,
        warehouse_id: destId,
        type: "xfer_arrive",
        quantity: item.quantity,
        reference: transfer.transfer_number,
        notes: "In transit on stock transfer",
        created_by: actor,
      });
    }
    await patchRow(db, "stock_transfers", transfer.id, {
      status: "in_transit",
      shipped_at: new Date().toISOString(),
    });
  }

  // T1: draft
  await createTransfer({
    number: `ST-DEMO-${tag}-0001`,
    sourceId: wh.mum,
    destId: wh.blr,
    items: [{ sku: "ELEC-004", quantity: 10 }],
    daysAgoOrdered: 1,
  });

  // T2: requested
  {
    const t = await createTransfer({
      number: `ST-DEMO-${tag}-0002`,
      sourceId: wh.mum,
      destId: wh.del,
      items: [{ sku: "OFF-001", quantity: 50 }],
      daysAgoOrdered: 2,
    });
    await patchRow(db, "stock_transfers", t.transfer.id, { status: "requested" });
  }

  // T3: approved
  {
    const t = await createTransfer({
      number: `ST-DEMO-${tag}-0003`,
      sourceId: wh.blr,
      destId: wh.mum,
      items: [{ sku: "MOB-002", quantity: 100 }],
      daysAgoOrdered: 3,
    });
    await patchRow(db, "stock_transfers", t.transfer.id, { status: "requested" });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "approved",
      approved_by: actor,
    });
  }

  // T4: in_transit
  {
    const t = await createTransfer({
      number: `ST-DEMO-${tag}-0004`,
      sourceId: wh.mum,
      destId: wh.blr,
      items: [{ sku: "PKG-003", quantity: 40 }],
      daysAgoOrdered: 2,
    });
    await patchRow(db, "stock_transfers", t.transfer.id, { status: "requested" });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "approved",
      approved_by: actor,
    });
    await shipTransfer(t.transfer, t.items, wh.mum, wh.blr);
  }

  // T5: received, with a partial receive + damage on one line
  {
    const t = await createTransfer({
      number: `ST-DEMO-${tag}-0005`,
      sourceId: wh.mum,
      destId: wh.blr,
      items: [
        { sku: "PKG-001", quantity: 50 },
        { sku: "ELEC-002", quantity: 30 },
      ],
      daysAgoOrdered: 6,
    });
    await patchRow(db, "stock_transfers", t.transfer.id, { status: "requested" });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "approved",
      approved_by: actor,
    });
    await shipTransfer(t.transfer, t.items, wh.mum, wh.blr);

    const [pkgItem, elecItem] = t.items;
    if (!pkgItem || !elecItem) throw new Error("Expected 2 transfer items");
    await insertMovement(db, track, orgId, {
      product_id: pkgItem.product_id,
      warehouse_id: wh.blr,
      type: "xfer_receive",
      quantity: 45,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: actor,
    });
    await insertMovement(db, track, orgId, {
      product_id: pkgItem.product_id,
      warehouse_id: wh.blr,
      type: "xfer_receive_damaged",
      quantity: 5,
      reference: t.transfer.transfer_number,
      notes: "Received damaged against stock transfer",
      created_by: actor,
    });
    await patchRow(db, "stock_transfer_items", pkgItem.id, {
      received_quantity: 45,
      damaged_quantity: 5,
    });
    await insertMovement(db, track, orgId, {
      product_id: elecItem.product_id,
      warehouse_id: wh.blr,
      type: "xfer_receive",
      quantity: 30,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: actor,
    });
    await patchRow(db, "stock_transfer_items", elecItem.id, { received_quantity: 30 });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "received",
      received_at: new Date().toISOString(),
    });
  }

  // T6: completed
  {
    const t = await createTransfer({
      number: `ST-DEMO-${tag}-0006`,
      sourceId: wh.blr,
      destId: wh.del,
      items: [{ sku: "MOB-001", quantity: 100 }],
      daysAgoOrdered: 12,
    });
    await patchRow(db, "stock_transfers", t.transfer.id, { status: "requested" });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "approved",
      approved_by: actor,
    });
    await shipTransfer(t.transfer, t.items, wh.blr, wh.del);
    const [item] = t.items;
    if (!item) throw new Error("Expected 1 transfer item");
    await insertMovement(db, track, orgId, {
      product_id: item.product_id,
      warehouse_id: wh.del,
      type: "xfer_receive",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Received against stock transfer",
      created_by: actor,
    });
    await patchRow(db, "stock_transfer_items", item.id, { received_quantity: item.quantity });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "received",
      received_at: new Date().toISOString(),
    });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
  }

  // T7: cancelled while in transit (full reversal)
  {
    const t = await createTransfer({
      number: `ST-DEMO-${tag}-0007`,
      sourceId: wh.mum,
      destId: wh.del,
      items: [{ sku: "OFF-002", quantity: 80 }],
      daysAgoOrdered: 4,
    });
    await patchRow(db, "stock_transfers", t.transfer.id, { status: "requested" });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "approved",
      approved_by: actor,
    });
    await shipTransfer(t.transfer, t.items, wh.mum, wh.del);
    const [item] = t.items;
    if (!item) throw new Error("Expected 1 transfer item");
    await insertMovement(db, track, orgId, {
      product_id: item.product_id,
      warehouse_id: wh.mum,
      type: "xfer_cancel_ship",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Stock transfer cancelled in transit",
      created_by: actor,
    });
    await insertMovement(db, track, orgId, {
      product_id: item.product_id,
      warehouse_id: wh.del,
      type: "xfer_cancel_arrive",
      quantity: item.quantity,
      reference: t.transfer.transfer_number,
      notes: "Stock transfer cancelled in transit",
      created_by: actor,
    });
    await patchRow(db, "stock_transfers", t.transfer.id, {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    });
  }
  await flush();

  // -- Alerts for the deliberately low/out-of-stock products above ----------
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
      action: `PO-DEMO-${tag}-0004 already sent to Bharat Packaging Solutions`,
    },
    {
      sku: "RAW-002",
      title: "Out of stock: Steel Sheet 2mm at Mumbai Central Warehouse",
      severity: "critical",
      action: "Reorder urgently from Sundar Raw Materials Pvt Ltd (lead time 10 days)",
    },
  ];
  for (const a of alertDefs) {
    const productName = productDefs.find((p) => p.sku === a.sku)!.name;
    await insertTracked(
      db,
      "alerts",
      [
        {
          org_id: orgId,
          type: "low_stock",
          severity: a.severity,
          status: "open",
          title: a.title,
          description: `${productName} (${a.sku}) has fallen at or below its reorder point.`,
          entity_type: "product",
          entity_id: getProd(a.sku).id,
          recommended_action: a.action,
        },
      ],
      track,
    );
  }
  await flush();
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requirePlatformAdmin])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .order("email", { ascending: true });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    return data ?? [];
  });

const listOrgsInput = z.object({ userId: z.string().uuid() });

export const adminListOrgsForUser = createServerFn({ method: "GET" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => listOrgsInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("organization_members")
      .select("role, organizations(id, name, slug)")
      .eq("user_id", data.userId);
    if (error) throw new Error(`Failed to list businesses: ${error.message}`);
    return (rows ?? [])
      .filter((r) => r.organizations)
      .map((r) => ({
        id: (r.organizations as unknown as { id: string; name: string; slug: string }).id,
        name: (r.organizations as unknown as { id: string; name: string; slug: string }).name,
        slug: (r.organizations as unknown as { id: string; name: string; slug: string }).slug,
        role: r.role,
      }));
  });

const seedInput = z.object({ orgId: z.string().uuid(), targetUserId: z.string().uuid() });

export const adminSeedDemoData = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => seedInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: org, error: orgError } = await db
      .from("organizations")
      .select("id, name")
      .eq("id", data.orgId)
      .maybeSingle();
    if (orgError) throw new Error(`Failed to load organization: ${orgError.message}`);
    if (!org) throw new Error("Organization not found.");

    let { data: ownerRows } = await db
      .from("organization_members")
      .select("user_id")
      .eq("org_id", data.orgId)
      .eq("role", "owner")
      .limit(1);
    if (!ownerRows?.length) {
      const res = await db
        .from("organization_members")
        .select("user_id")
        .eq("org_id", data.orgId)
        .eq("role", "admin")
        .limit(1);
      ownerRows = res.data;
    }
    const owner = ownerRows?.[0];
    if (!owner) {
      throw new Error(
        "This business has no owner or admin member yet — add one before seeding demo data.",
      );
    }
    const actor = owner.user_id as string;

    const { data: batch, error: batchError } = await db
      .from("demo_seed_batches")
      .insert({
        org_id: data.orgId,
        target_user_id: data.targetUserId,
        requested_by: context.userId,
      })
      .select()
      .single();
    if (batchError || !batch) {
      throw new Error(`Failed to start seed batch: ${batchError?.message}`);
    }

    const track: Track = [];
    const flush = () => flushTrack(db, batch.id, track);
    try {
      await seedOrg(db, data.orgId, actor, track, flush);
      await flush();
    } catch (err) {
      await flush().catch(() => {});
      throw err;
    }

    const { count } = await db
      .from("demo_seed_records")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id);
    await db
      .from("demo_seed_batches")
      .update({ record_count: count ?? 0 })
      .eq("id", batch.id);

    return { batchId: batch.id as string, recordCount: count ?? 0, orgName: org.name as string };
  });

const orgIdInput = z.object({ orgId: z.string().uuid() });

export const adminListSeedBatches = createServerFn({ method: "GET" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => orgIdInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: batches, error } = await supabaseAdmin
      .from("demo_seed_batches")
      .select("id, target_user_id, requested_by, record_count, created_at")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to list seed batches: ${error.message}`);
    const userIds = Array.from(
      new Set((batches ?? []).flatMap((b) => [b.target_user_id, b.requested_by])),
    );
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, email").in("id", userIds)
      : { data: [] };
    const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));
    return (batches ?? []).map((b) => ({
      ...b,
      targetUserEmail: emailById.get(b.target_user_id) ?? null,
      requestedByEmail: emailById.get(b.requested_by) ?? null,
    }));
  });

// Deletion order matters: dependents before the tables they reference, so
// this never trips a foreign-key restriction. Several of these already
// cascade automatically (e.g. *_items rows when their parent order is
// deleted) -- deleting them explicitly first is harmless and keeps this
// list correct even if a future migration changes a cascade rule.
const DELETE_ORDER = [
  "stock_movements",
  "alerts",
  "einvoices",
  "eway_bills",
  "credit_notes",
  "debit_notes",
  "proforma_invoices",
  "sales_invoice_items",
  "sales_invoices",
  "sales_order_items",
  "sales_orders",
  "stock_transfer_items",
  "stock_transfers",
  "purchase_order_items",
  "purchase_orders",
  "products",
  "customers",
  "suppliers",
  "warehouses",
  "categories",
];

export const adminDeleteSeedData = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => orgIdInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: batches, error: batchesError } = await db
      .from("demo_seed_batches")
      .select("id")
      .eq("org_id", data.orgId);
    if (batchesError) throw new Error(`Failed to load seed batches: ${batchesError.message}`);
    const batchIds = (batches ?? []).map((b) => b.id as string);
    if (!batchIds.length) return { deletedRecords: 0, deletedBatches: 0 };

    let deletedRecords = 0;
    for (const table of DELETE_ORDER) {
      const { data: rows, error } = await db
        .from("demo_seed_records")
        .select("record_id")
        .in("batch_id", batchIds)
        .eq("table_name", table);
      if (error) throw new Error(`Failed to load tracked ${table} rows: ${error.message}`);
      const ids = Array.from(new Set((rows ?? []).map((r) => r.record_id as string)));
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { error: delError } = await (db as AdminDb).from(table).delete().in("id", chunk);
        if (delError) throw new Error(`Failed to delete ${table} rows: ${delError.message}`);
        deletedRecords += chunk.length;
      }
    }

    // demo_seed_records cascades from demo_seed_batches.
    const { error: deleteBatchesError } = await db
      .from("demo_seed_batches")
      .delete()
      .in("id", batchIds);
    if (deleteBatchesError) {
      throw new Error(`Failed to delete seed batches: ${deleteBatchesError.message}`);
    }

    return { deletedRecords, deletedBatches: batchIds.length };
  });
