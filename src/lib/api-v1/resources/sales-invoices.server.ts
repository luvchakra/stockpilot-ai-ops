// Read-only: invoices are generated from a sales order via a workflow
// action (generate_sales_invoice), not created directly -- that action,
// plus credit notes, are a fast-follow once a real integration needs to
// drive them, per the ticket's "foundation to extend" framing.
import { createCrudHandler } from "../crud.server";

export const handle = createCrudHandler({
  table: "sales_invoices",
  listSelect:
    "id, invoice_number, invoice_date, customer_id, customers(name), sales_order_id, subtotal, discount_amount, cgst_amount, sgst_amount, igst_amount, shipping_amount, total_amount, payment_status, created_at",
  singleSelect:
    "id, invoice_number, invoice_date, customer_id, customers(name), sales_order_id, customer_gstin, billing_address, shipping_address, subtotal, discount_amount, cgst_amount, sgst_amount, igst_amount, shipping_amount, total_amount, payment_status, created_at, sales_invoice_items(id, product_id, hsn_code, quantity, unit_price, tax_rate, cgst_amount, sgst_amount, igst_amount, products(sku, name))",
  defaultOrder: { column: "invoice_date", ascending: false },
});
