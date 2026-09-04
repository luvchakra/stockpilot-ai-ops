export interface ScannableProduct {
  id: string;
  sku: string;
  barcode?: string | null;
}

// Resolves a scanned/typed value to a product: exact barcode match first,
// falling back to an exact (case-insensitive) SKU match so a scanner
// loaded with plain SKU labels -- or a warehouse operator just typing the
// SKU -- also works, not only products that already have a barcode
// generated.
export function resolveProductByScan<T extends ScannableProduct>(
  products: T[],
  scanned: string,
): T | null {
  const value = scanned.trim();
  if (!value) return null;
  const byBarcode = products.find((p) => p.barcode && p.barcode === value);
  if (byBarcode) return byBarcode;
  const lower = value.toLowerCase();
  return products.find((p) => p.sku.toLowerCase() === lower) ?? null;
}
