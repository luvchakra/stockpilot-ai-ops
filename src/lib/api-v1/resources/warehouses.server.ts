import { createCrudHandler } from "../crud.server";

const FIELDS = [
  "name",
  "code",
  "type",
  "address",
  "city",
  "state",
  "postal_code",
  "country",
  "contact_name",
  "contact_phone",
  "is_active",
] as const;

export const handle = createCrudHandler({
  table: "warehouses",
  listSelect:
    "id, name, code, type, address, city, state, postal_code, country, contact_name, contact_phone, is_active, created_at, updated_at",
  defaultOrder: { column: "name", ascending: true },
  writePermission: "inventory.edit",
  insertFields: FIELDS,
  updateFields: FIELDS,
});
