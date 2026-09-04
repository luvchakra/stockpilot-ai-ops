import { createCrudHandler } from "../crud.server";

const FIELDS = [
  "name",
  "code",
  "contact_person",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "gst_number",
  "payment_terms",
  "lead_time_days",
  "min_order_quantity",
  "rating",
  "is_active",
] as const;

export const handle = createCrudHandler({
  table: "suppliers",
  listSelect:
    "id, name, code, contact_person, email, phone, address, city, state, gst_number, payment_terms, lead_time_days, min_order_quantity, rating, is_active, created_at, updated_at",
  defaultOrder: { column: "name", ascending: true },
  writePermission: "suppliers.edit",
  insertFields: FIELDS,
  updateFields: FIELDS,
});
