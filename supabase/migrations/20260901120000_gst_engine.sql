-- GST (Goods & Services Tax) calculation engine for purchases, plus the org
-- profile fields it needs to determine intrastate vs interstate tax.
--
-- Scope: purchase-side (inward supply) tax computation and CGST/SGST/IGST
-- storage. Outward-supply (sales) tax needs the Sales Orders/Invoicing
-- module, which doesn't exist yet, so it isn't part of this migration.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS gstin TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS gst_registration_type TEXT NOT NULL DEFAULT 'regular'
    CHECK (gst_registration_type IN ('regular', 'composition', 'unregistered'));

-- Snapshot the GST rate onto each PO line at save time (rather than always
-- reading the product's *current* tax_rate), so a later rate change on the
-- product doesn't retroactively rewrite the tax on a historical purchase
-- order. Also store the computed CGST/SGST/IGST split per line so the GST
-- filing report can be built straight from this table without recomputing
-- historical splits against today's org/supplier state.
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
