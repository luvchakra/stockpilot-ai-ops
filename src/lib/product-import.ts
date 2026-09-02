import { GST_RATE_SLABS } from "@/lib/gst";

export type ImportFieldKey =
  | "sku"
  | "name"
  | "brand"
  | "category"
  | "supplier"
  | "unit"
  | "hsn_code"
  | "tax_rate"
  | "cost_price"
  | "selling_price"
  | "reorder_point"
  | "reorder_quantity"
  | "barcode"
  | "description";

export interface ImportField {
  key: ImportFieldKey;
  label: string;
  required: boolean;
  aliases: string[];
}

// Aliases are matched against normalizeHeader() output, so "GST Rate (%)" and "gst_rate" both hit "gstrate" here.
export const IMPORT_FIELDS: ImportField[] = [
  { key: "sku", label: "SKU", required: true, aliases: ["sku", "productcode", "itemcode", "code"] },
  {
    key: "name",
    label: "Product name",
    required: true,
    aliases: ["name", "productname", "product", "itemname", "title"],
  },
  { key: "brand", label: "Brand", required: false, aliases: ["brand", "make", "manufacturer"] },
  {
    key: "category",
    label: "Category",
    required: false,
    aliases: ["category", "productcategory", "type"],
  },
  {
    key: "supplier",
    label: "Preferred supplier",
    required: false,
    aliases: ["supplier", "vendor", "preferredsupplier"],
  },
  { key: "unit", label: "Unit", required: false, aliases: ["unit", "uom", "unitofmeasure"] },
  { key: "hsn_code", label: "HSN code", required: false, aliases: ["hsn", "hsncode", "hsnsac"] },
  {
    key: "tax_rate",
    label: "GST rate (%)",
    required: false,
    aliases: ["gstrate", "gst", "taxrate", "tax", "gstpercent", "taxpercent"],
  },
  {
    key: "cost_price",
    label: "Cost price",
    required: false,
    aliases: ["costprice", "cost", "purchaseprice", "buyprice"],
  },
  {
    key: "selling_price",
    label: "Selling price",
    required: false,
    aliases: ["sellingprice", "saleprice", "price", "mrp"],
  },
  {
    key: "reorder_point",
    label: "Reorder point",
    required: false,
    aliases: ["reorderpoint", "reorderlevel", "minstock", "minimumstock"],
  },
  {
    key: "reorder_quantity",
    label: "Reorder quantity",
    required: false,
    aliases: ["reorderquantity", "reorderqty", "reorderamount"],
  },
  { key: "barcode", label: "Barcode", required: false, aliases: ["barcode", "ean", "upc"] },
  {
    key: "description",
    label: "Description",
    required: false,
    aliases: ["description", "notes", "details"],
  },
];

export const IGNORE_COLUMN = "__ignore__" as const;
export type ColumnMapping = Record<number, ImportFieldKey | typeof IGNORE_COLUMN>;

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<ImportFieldKey>();

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const match = IMPORT_FIELDS.find(
      (field) => !used.has(field.key) && field.aliases.includes(normalized),
    );
    if (match) {
      mapping[index] = match.key;
      used.add(match.key);
    } else {
      mapping[index] = IGNORE_COLUMN;
    }
  });

  return mapping;
}

export interface ImportRow {
  id: string;
  sourceRowNumber: number; // 1-based, counting the header as row 1
  values: Partial<Record<ImportFieldKey, string>>;
  errors: string[];
  included: boolean;
}

export function buildRowsFromMapping(
  dataRows: string[][],
  mapping: ColumnMapping,
): Omit<ImportRow, "errors" | "included">[] {
  return dataRows.map((cells, i) => {
    const values: Partial<Record<ImportFieldKey, string>> = {};
    for (const [colIndexStr, target] of Object.entries(mapping)) {
      if (target === IGNORE_COLUMN) continue;
      const colIndex = Number(colIndexStr);
      values[target] = (cells[colIndex] ?? "").trim();
    }
    return { id: `row-${i}`, sourceRowNumber: i + 2, values };
  });
}

const NUMERIC_FIELDS: ImportFieldKey[] = [
  "cost_price",
  "selling_price",
  "reorder_point",
  "reorder_quantity",
];

function parseNumeric(value: string): number | null {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

export function validateRows(
  rows: Omit<ImportRow, "errors" | "included">[],
  existingSkusLower: Set<string>,
): ImportRow[] {
  const skuCounts = new Map<string, number>();
  for (const row of rows) {
    const sku = (row.values.sku ?? "").trim().toLowerCase();
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }

  return rows.map((row) => {
    const errors: string[] = [];
    const sku = (row.values.sku ?? "").trim();
    const name = (row.values.name ?? "").trim();

    if (!sku) errors.push("Missing SKU");
    if (!name) errors.push("Missing product name");

    if (sku) {
      const skuLower = sku.toLowerCase();
      if ((skuCounts.get(skuLower) ?? 0) > 1) {
        errors.push("Duplicate SKU in file");
      } else if (existingSkusLower.has(skuLower)) {
        errors.push("SKU already exists in your catalogue");
      }
    }

    const taxRateRaw = row.values.tax_rate?.trim();
    if (taxRateRaw) {
      const rate = Number(taxRateRaw);
      if (!Number.isFinite(rate) || !(GST_RATE_SLABS as readonly number[]).includes(rate)) {
        errors.push(
          `Invalid GST rate "${taxRateRaw}" (must be one of ${GST_RATE_SLABS.join(", ")})`,
        );
      }
    }

    for (const field of NUMERIC_FIELDS) {
      const raw = row.values[field]?.trim();
      if (!raw) continue;
      const n = parseNumeric(raw);
      if (n === null || n < 0) {
        const label = IMPORT_FIELDS.find((f) => f.key === field)?.label ?? field;
        errors.push(`${label} must be a non-negative number`);
      }
    }

    return { ...row, errors, included: errors.length === 0 };
  });
}

export function buildTemplateCsv(): string {
  const headers = IMPORT_FIELDS.map((f) => f.label);
  const example = [
    "SKU-1001",
    "Wireless Mouse",
    "Logitech",
    "Electronics",
    "",
    "pcs",
    "8471",
    "18",
    "450",
    "699",
    "10",
    "25",
    "",
    "Ergonomic wireless mouse",
  ];
  return toCsv([headers, example]);
}

export function buildErrorRowsCsv(rows: ImportRow[]): string {
  const headers = [...IMPORT_FIELDS.map((f) => f.label), "Errors"];
  const errorRows = rows.filter((r) => r.errors.length > 0);
  const lines = errorRows.map((row) => [
    ...IMPORT_FIELDS.map((f) => row.values[f.key] ?? ""),
    row.errors.join("; "),
  ]);
  return toCsv([headers, ...lines]);
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function downloadTextFile(filename: string, content: string, mimeType = "text/csv") {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
