// e-Invoicing payload/response shapes (SP-8): IRN + QR code generation.
//
// Like e-Way Bill access (SP-7), real-world e-Invoicing access to the
// government's Invoice Registration Portal (IRP) is GSP-mediated (ClearTax,
// MasterGST, Vayana, etc.) -- a GSP wraps the same underlying GST INV-01
// JSON schema in its own REST API. This module builds/parses that
// documented schema (field names verified against the government's own
// e-invoice FAQ/schema docs and multiple independent GSP references) --
// the GSP-specific parts (base URLs, auth style, credentials) live in
// einvoice-actions.ts, which is the only place that knows which GSP a
// given org has configured. Deliberately independent of eway-bill.ts, per
// the ticket's own guidance to ship e-Invoicing without coupling it to the
// e-Way Bill feature.
//
// This has NOT been exercised against a live GSP or the IRP sandbox --
// this sandbox's network egress blocks every e-Invoicing/GSP domain, and
// there's no real GSP account to test with. The schema below is correct
// per documentation; treat the first real generation attempt as the real
// test, and watch for provider-specific quirks in the response shape.

import { roundCurrency } from "@/lib/gst";

export type EinvoiceStatus = "generated" | "cancelled";

export interface EinvoicePartyInfo {
  gstin: string | null;
  legalName: string;
  address: string | null;
  place: string | null;
  pincode: string | null;
  stateCode: string | null;
}

export interface EinvoiceLineItem {
  productName: string;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxableAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}

export interface EinvoiceDocumentInfo {
  docNo: string;
  docDate: string; // yyyy-mm-dd
  seller: EinvoicePartyInfo;
  buyer: EinvoicePartyInfo;
  items: EinvoiceLineItem[];
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  discountValue: number;
}

// dd/MM/yyyy, the date format the GST INV-01 schema expects for DocDtls.Dt.
function toNicDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// GSTIN "URP" (Unregistered Person) is the standard placeholder for a
// party with no GSTIN -- e-Invoicing is a B2B-only flow, so this is a
// fallback rather than the expected case.
const UNREGISTERED = "URP";

export function buildEinvoicePayload(info: EinvoiceDocumentInfo) {
  const totInvValue = roundCurrency(
    info.totalValue + info.cgstValue + info.sgstValue + info.igstValue - info.discountValue,
  );
  return {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: "N",
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: "INV",
      No: info.docNo,
      Dt: toNicDate(info.docDate),
    },
    SellerDtls: {
      Gstin: info.seller.gstin || UNREGISTERED,
      LglNm: info.seller.legalName,
      Addr1: info.seller.address ?? "",
      Loc: info.seller.place ?? "",
      Pin: info.seller.pincode ? Number(info.seller.pincode) : 0,
      Stcd: info.seller.stateCode ?? "",
    },
    BuyerDtls: {
      Gstin: info.buyer.gstin || UNREGISTERED,
      LglNm: info.buyer.legalName,
      Pos: info.buyer.stateCode ?? "",
      Addr1: info.buyer.address ?? "",
      Loc: info.buyer.place ?? "",
      Pin: info.buyer.pincode ? Number(info.buyer.pincode) : 0,
      Stcd: info.buyer.stateCode ?? "",
    },
    ItemList: info.items.map((item, idx) => ({
      SlNo: String(idx + 1),
      PrdDesc: item.productName,
      IsServc: "N",
      HsnCd: item.hsnCode ?? "",
      Qty: item.quantity,
      Unit: item.unit,
      UnitPrice: roundCurrency(item.unitPrice),
      TotAmt: roundCurrency(item.taxableAmount),
      Discount: 0,
      AssAmt: roundCurrency(item.taxableAmount),
      GstRt: item.cgstRate + item.sgstRate + item.igstRate,
      CgstAmt: roundCurrency(item.cgstAmount),
      SgstAmt: roundCurrency(item.sgstAmount),
      IgstAmt: roundCurrency(item.igstAmount),
      TotItemVal: roundCurrency(
        item.taxableAmount + item.cgstAmount + item.sgstAmount + item.igstAmount,
      ),
    })),
    ValDtls: {
      AssVal: roundCurrency(info.totalValue),
      CgstVal: roundCurrency(info.cgstValue),
      SgstVal: roundCurrency(info.sgstValue),
      IgstVal: roundCurrency(info.igstValue),
      Discount: roundCurrency(info.discountValue),
      TotInvVal: totInvValue,
    },
  };
}

export type EinvoiceErrorCode =
  | "credentials_not_configured"
  | "authentication_failed"
  | "invalid_request"
  | "provider_unreachable"
  | "unexpected_response"
  | "cancel_window_expired"
  | "not_found"
  | "forbidden";

export class EinvoiceError extends Error {
  code: EinvoiceErrorCode;
  details?: unknown;
  constructor(code: EinvoiceErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "EinvoiceError";
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

// IRP dates typically come back as "dd/MM/yyyy hh:mm:ss AM/PM"; fall back
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
  throw new EinvoiceError(
    "unexpected_response",
    `Could not parse date "${value}" from the e-Invoicing provider's response.`,
  );
}

export interface EinvoiceGenerateResult {
  irn: string;
  ackNo: string;
  ackDate: string; // ISO
  qrCode: string;
  raw: Record<string, unknown>;
}

// Defensive across the field-name variants different GSPs use for the
// same NIC/IRP-defined values.
export function parseGenerateResponse(raw: Record<string, unknown>): EinvoiceGenerateResult {
  const irn = firstDefined(raw, ["Irn", "IRN", "irn"]);
  const ackNo = firstDefined(raw, ["AckNo", "ackNo", "ack_no"]);
  const ackDateRaw = firstDefined(raw, ["AckDt", "ackDt", "ack_date", "AckDate"]);
  const qrCode = firstDefined(raw, ["SignedQRCode", "QRCode", "qrCode", "signedQRCode"]);
  if (!irn || !ackNo || !ackDateRaw || !qrCode) {
    throw new EinvoiceError(
      "unexpected_response",
      "The e-Invoicing provider returned a response missing the IRN, Ack No/date, or QR code.",
      raw,
    );
  }
  return {
    irn: String(irn),
    ackNo: String(ackNo),
    ackDate: parseProviderDate(String(ackDateRaw)),
    qrCode: String(qrCode),
    raw,
  };
}

export function extractAuthToken(raw: Record<string, unknown>): string {
  const token = firstDefined(raw, ["authtoken", "access_token", "token", "AuthToken"]);
  if (!token) {
    throw new EinvoiceError(
      "authentication_failed",
      "The e-Invoicing provider's authentication response did not include a token.",
      raw,
    );
  }
  return String(token);
}

// The IRP only allows cancelling an e-Invoice (IRN) within 24 hours of
// generation.
export const CANCEL_WINDOW_HOURS = 24;

export function isWithinCancelWindow(ackDate: string, now: Date = new Date()): boolean {
  const generated = new Date(ackDate);
  const hoursElapsed = (now.getTime() - generated.getTime()) / (1000 * 60 * 60);
  return hoursElapsed <= CANCEL_WINDOW_HOURS;
}
