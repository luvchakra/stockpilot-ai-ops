// Indian GST (Goods & Services Tax) helpers: GSTIN validation, state-code
// resolution, and CGST/SGST-vs-IGST tax computation.
//
// Reference facts this file encodes:
// - A GSTIN's first 2 digits are the taxpayer's GST state code.
// - Tax on a transaction is split CGST+SGST when buyer and seller share a
//   state (intrastate) and IGST when they don't (interstate) — the combined
//   rate is the same either way, only the split differs.
// - The 15th GSTIN character is a checksum digit computed over the first 14
//   characters using a mod-36 scheme (published by GSTN).

export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

// Reverse lookup, normalized (lowercase, trimmed) state/UT name -> code.
// Keyed off GST_STATE_CODES plus a couple of common spelling variants.
const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(GST_STATE_CODES).map(([code, name]) => [name.toLowerCase(), code]),
);
STATE_NAME_TO_CODE["orissa"] = "21";
STATE_NAME_TO_CODE["pondicherry"] = "34";

export const INDIAN_STATES = Object.entries(GST_STATE_CODES)
  .filter(([code]) => code !== "97" && code !== "99")
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// The GST Council's standard ad-valorem slabs. Cess and a handful of
// special rates (0.25%, 3% on precious metals, etc.) exist but the common
// slabs below cover the vast majority of goods a distributor/retailer sells.
export const GST_RATE_SLABS = [0, 0.25, 3, 5, 12, 18, 28] as const;

export function normalizeStateName(name: string): string {
  return name.trim().toLowerCase();
}

export function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  return STATE_NAME_TO_CODE[normalizeStateName(name)] ?? null;
}

export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.slice(0, 2);
  return GST_STATE_CODES[code] ? code : null;
}

/** Best-effort state code: prefer an explicit state name, fall back to the GSTIN prefix. */
export function resolveStateCode(
  stateName: string | null | undefined,
  gstin: string | null | undefined,
): string | null {
  return stateCodeFromName(stateName) ?? stateCodeFromGstin(gstin);
}

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function isValidGstinFormat(gstin: string): boolean {
  return GSTIN_FORMAT.test(gstin);
}

/** Verifies the 15th (checksum) character against GSTN's published mod-36 scheme. */
export function gstinChecksumValid(gstin: string): boolean {
  if (gstin.length !== 15) return false;
  let factor = 2;
  let sum = 0;
  for (let i = 13; i >= 0; i--) {
    const codePoint = GSTIN_CHARSET.indexOf(gstin.charAt(i));
    if (codePoint === -1) return false;
    let digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
  }
  const checkCodePoint = (36 - (sum % 36)) % 36;
  return gstin.charAt(14) === GSTIN_CHARSET.charAt(checkCodePoint);
}

/** Full validation: 15-char structure (incl. embedded PAN shape) + checksum digit. */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const cleaned = gstin.trim().toUpperCase();
  return isValidGstinFormat(cleaned) && gstinChecksumValid(cleaned);
}

export function roundCurrency(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface GstBreakup {
  /** true = IGST applies, false = CGST+SGST applies, null = couldn't be determined. */
  isInterstate: boolean | null;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  /** True when seller/buyer state couldn't be resolved, so amounts above are 0. */
  incomplete: boolean;
}

/**
 * Splits a single line's GST into CGST+SGST (intrastate) or IGST
 * (interstate) based on the seller's and buyer's state codes. Returns a
 * zeroed, `incomplete: true` result rather than guessing when either state
 * is unknown — silently defaulting to the wrong split is the single most
 * common manual-invoicing mistake this is meant to prevent.
 */
export function computeLineGst(input: {
  taxableValue: number;
  gstRatePercent: number;
  sellerStateCode: string | null;
  buyerStateCode: string | null;
}): GstBreakup {
  const { taxableValue, gstRatePercent, sellerStateCode, buyerStateCode } = input;

  if (!sellerStateCode || !buyerStateCode) {
    return {
      isInterstate: null,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      totalTax: 0,
      incomplete: true,
    };
  }

  const isInterstate = sellerStateCode !== buyerStateCode;
  if (isInterstate) {
    const igstAmount = roundCurrency((taxableValue * gstRatePercent) / 100);
    return {
      isInterstate: true,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: gstRatePercent,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount,
      totalTax: igstAmount,
      incomplete: false,
    };
  }

  const halfRate = gstRatePercent / 2;
  const cgstAmount = roundCurrency((taxableValue * halfRate) / 100);
  const sgstAmount = roundCurrency((taxableValue * halfRate) / 100);
  return {
    isInterstate: false,
    cgstRate: halfRate,
    sgstRate: halfRate,
    igstRate: 0,
    cgstAmount,
    sgstAmount,
    totalTax: roundCurrency(cgstAmount + sgstAmount),
    igstAmount: 0,
    incomplete: false,
  };
}

export function aggregateGst(lines: GstBreakup[]): {
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  incomplete: boolean;
} {
  return {
    cgstAmount: roundCurrency(lines.reduce((s, l) => s + l.cgstAmount, 0)),
    sgstAmount: roundCurrency(lines.reduce((s, l) => s + l.sgstAmount, 0)),
    igstAmount: roundCurrency(lines.reduce((s, l) => s + l.igstAmount, 0)),
    totalTax: roundCurrency(lines.reduce((s, l) => s + l.totalTax, 0)),
    incomplete: lines.some((l) => l.incomplete),
  };
}
