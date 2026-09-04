import { createCrudHandler } from "../crud.server";

const FIELDS = [
  "sku",
  "name",
  "brand",
  "description",
  "category_id",
  "supplier_id",
  "unit",
  "hsn_code",
  "tax_rate",
  "cost_price",
  "selling_price",
  "reorder_point",
  "reorder_quantity",
  "barcode",
  "image_url",
  "status",
] as const;

export const handle = createCrudHandler({
  table: "products",
  listSelect:
    "id, sku, name, brand, description, category_id, supplier_id, unit, hsn_code, tax_rate, cost_price, selling_price, reorder_point, reorder_quantity, barcode, image_url, status, created_at, updated_at",
  defaultOrder: { column: "name", ascending: true },
  writePermission: "inventory.edit",
  insertFields: FIELDS,
  updateFields: FIELDS,
  maskFields: [{ column: "cost_price", permission: "inventory.view_cost" }],
});
