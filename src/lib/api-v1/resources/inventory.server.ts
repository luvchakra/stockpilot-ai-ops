// Read-only per the ticket ("Inventory levels (read)") -- writes to
// stock go through a recorded stock_movements entry (adjustments,
// receiving, shipping, ...), never a direct stock_levels PATCH, in the
// UI as much as the API.
import { createCrudHandler } from "../crud.server";

export const handle = createCrudHandler({
  table: "stock_levels",
  listSelect:
    "id, product_id, warehouse_id, quantity, reserved, damaged, expired, in_transit, incoming, updated_at, products(sku, name), warehouses(name, code)",
  defaultOrder: { column: "updated_at", ascending: false },
});
