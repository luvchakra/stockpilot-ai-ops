// e-Way Bill payload/response shapes (SP-7).
//
// e-Way Bill access in India is GSP-mediated: a business goes through a
// commercial GSP (ClearTax, MasterGST, Vayana, Whitebooks, etc.), each
// exposing its own REST wrapper around the same underlying NIC Part-A/
// Part-B JSON schema. This module builds/parses that documented NIC
// schema (field names verified against the government's own API docs and
// multiple independent GSP references) -- the GSP-specific parts (base
// URLs, auth style, credentials) live in eway-bill-actions.ts, which is
// the only place that knows which GSP a given org has configured.
//
// This has NOT been exercised against a live GSP or the NIC sandbox --
// this sandbox's network egress blocks every e-Way Bill/GSP domain, and
// there's no real GSP account to test with. The schema below is correct
// per documentation; treat the first real generation attempt as the real
// test, and watch for provider-specific quirks in the response shape.

export const EWAY_BILL_THRESHOLD_INR = 50000;

export type EwayBillTransportMode = "road" | "rail" | "air" | "ship";
export type EwayBillSourceType = "sales_order" | "sales_invoice" | "purchase_order";
export type EwayBillStatus = "generated" | "cancelled" | "expired";

export const TRANSPORT_MODE_LABEL: Record<EwayBillTransportMode, string> = {
  road: "Road",
  rail: "Rail",
  air: "Air",
  ship: "Ship",
};

// NIC's transMode is a numeric code: 1 Road, 2 Rail, 3 Air, 4 Ship.
const TRANSPORT_MODE_CODE: Record<EwayBillTransportMode, number> = {
  road: 1,
  rail: 2,
  air: 3,
  ship: 4,
};

export const SOURCE_TYPE_LABEL: Record<EwayBillSourceType, string> = {
  sales_order: "Sales Order",
  sales_invoice: "Sales Invoice",
  purchase_order: "Purchase Order",
};

export interface EwayBillPartyInfo {
  gstin: string | null;
  legalName: string;
  address: string | null;
  place: string | null;
  pincode: string | null;
  stateCode: string | null;
}

export interface EwayBillLineItem {
  productName: string;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  taxableAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}

export interface EwayBillDocumentInfo {
  docType: "INV" | "CHL" | "OTH";
  docNo: string;
  docDate: string; // yyyy-mm-dd
  supplyType: "O" | "I"; // Outward (sales) or Inward (purchase)
  from: EwayBillPartyInfo;
  to: EwayBillPartyInfo;
  items: EwayBillLineItem[];
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  transportMode: EwayBillTransportMode;
  vehicleNumber?: string;
  transporterId?: string;
  transporterName?: string;
  transDistanceKm?: number;
}

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

// dd/MM/yyyy, the date format the NIC schema expects for docDate.
function toNicDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// GSTIN "URP" (Unregistered Person) is the standard NIC placeholder for a
// party with no GSTIN.
const UNREGISTERED = "URP";

export function buildEwayBillPayload(info: EwayBillDocumentInfo) {
  return {
    supplyType: info.supplyType,
    subSupplyType: "1",
    docType: info.docType,
    docNo: info.docNo,
    docDate: toNicDate(info.docDate),
    fromGstin: info.from.gstin || UNREGISTERED,
    fromTrdName: info.from.legalName,
    fromAddr1: info.from.address ?? "",
    fromPlace: info.from.place ?? "",
    fromPincode: info.from.pincode ? Number(info.from.pincode) : 0,
    fromStateCode: info.from.stateCode ? Number(info.from.stateCode) : 0,
    toGstin: info.to.gstin || UNREGISTERED,
    toTrdName: info.to.legalName,
    toAddr1: info.to.address ?? "",
    toPlace: info.to.place ?? "",
    toPincode: info.to.pincode ? Number(info.to.pincode) : 0,
    toStateCode: info.to.stateCode ? Number(info.to.stateCode) : 0,
    transactionType: 1,
    itemList: info.items.map((item) => ({
      productName: item.productName,
      hsnCode: item.hsnCode ?? "",
      quantity: item.quantity,
      qtyUnit: item.unit,
      taxableAmount: roundCurrency(item.taxableAmount),
      cgstRate: item.cgstRate,
      sgstRate: item.sgstRate,
      igstRate: item.igstRate,
    })),
    totalValue: roundCurrency(info.totalValue),
    cgstValue: roundCurrency(info.cgstValue),
    sgstValue: roundCurrency(info.sgstValue),
    igstValue: roundCurrency(info.igstValue),
    totInvValue: roundCurrency(info.totalValue + info.cgstValue + info.sgstValue + info.igstValue),
    transporterId: info.transporterId || undefined,
    transporterName: info.transporterName || undefined,
    transDistance: info.transDistanceKm ?? 0,
    transMode: TRANSPORT_MODE_CODE[info.transportMode],
    vehicleNo: info.vehicleNumber || undefined,
  };
}

export type EwayBillErrorCode =
  | "credentials_not_configured"
  | "authentication_failed"
  | "invalid_request"
  | "provider_unreachable"
  | "unexpected_response"
  | "cancel_window_expired"
  | "not_found"
  | "forbidden";

export class EwayBillError extends Error {
  code: EwayBillErrorCode;
  details?: unknown;
  constructor(code: EwayBillErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "EwayBillError";
    this.code = code;
    this.details = details;
  }
}

function firstDefined(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

// NIC dates typically come back as "dd/MM/yyyy hh:mm:ss AM/PM"; fall back
// to a plain Date parse for GSPs that normalize to ISO already.
function parseProviderDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i.exec(
    value.trim(),
  );
  if (match) {
    const [, dd, mm, yyyy, hhRaw, min, sec, ampm] = match;
    let hh = Number(hhRaw);
    if (ampm) {
      if (ampm.toUpperCase() === "PM" && hh < 12) hh += 12;
      if (ampm.toUpperCase() === "AM" && hh === 12) hh = 0;
    }
    const iso = `${yyyy}-${mm}-${dd}T${String(hh).padStart(2, "0")}:${min}:${sec}`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const fallback = new Date(value);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  throw new EwayBillError(
    "unexpected_response",
    `Could not parse date "${value}" from the e-Way Bill provider's response.`,
  );
}

export interface EwayBillGenerateResult {
  ewbNumber: string;
  ewbDate: string; // ISO
  validUntil: string; // ISO
  raw: Record<string, unknown>;
}

// Defensive across the field-name variants different GSPs use for the
// same NIC-defined values.
export function parseGenerateResponse(raw: Record<string, unknown>): EwayBillGenerateResult {
  const ewbNumber = firstDefined(raw, ["ewbNo", "ewayBillNo", "ewbNumber", "EwbNo"]);
  const ewbDateRaw = firstDefined(raw, ["ewbDate", "ewayBillDate", "EwbDt"]);
  const validUntilRaw = firstDefined(raw, ["validUpto", "validUntil", "validUpTo", "ValidUpto"]);
  if (!ewbNumber || !ewbDateRaw || !validUntilRaw) {
    throw new EwayBillError(
      "unexpected_response",
      "The e-Way Bill provider returned a response missing the bill number, date, or validity.",
      raw,
    );
  }
  return {
    ewbNumber: String(ewbNumber),
    ewbDate: parseProviderDate(String(ewbDateRaw)),
    validUntil: parseProviderDate(String(validUntilRaw)),
    raw,
  };
}

export function extractAuthToken(raw: Record<string, unknown>): string {
  const token = firstDefined(raw, ["authtoken", "access_token", "token", "AuthToken"]);
  if (!token) {
    throw new EwayBillError(
      "authentication_failed",
      "The e-Way Bill provider's authentication response did not include a token.",
      raw,
    );
  }
  return String(token);
}

// The government portal only allows cancelling an e-Way Bill within 24
// hours of generation.
export const CANCEL_WINDOW_HOURS = 24;

export function isWithinCancelWindow(ewbDate: string, now: Date = new Date()): boolean {
  const generated = new Date(ewbDate);
  const hoursElapsed = (now.getTime() - generated.getTime()) / (1000 * 60 * 60);
  return hoursElapsed <= CANCEL_WINDOW_HOURS;
}
