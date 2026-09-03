-- Granular Roles & Permissions (SP-6), part 2: a permission catalog +
-- role -> permission mapping, a has_permission() RLS helper, and a
-- rewrite of every RLS write policy that currently checks has_org_role()
-- directly to check has_permission() instead, so the database enforces
-- exactly the eight-role access matrix from the PRD (module.action
-- catalog: inventory.*, suppliers.*, purchase_orders.*, customers.*,
-- sales_orders.*, invoices.*, alerts.*, settings.manage).
--
-- role_permissions.role is TEXT, not public.org_role: a future
-- custom-role builder only needs new rows here, never a schema change or
-- an enum rebuild. Static for now (no INSERT/UPDATE/DELETE policy for
-- authenticated) -- reachable only via migration or service_role, which
-- is exactly the "model supports it, no builder yet" scope this ticket
-- asks for.

CREATE TABLE public.permissions (
  key TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  description TEXT NOT NULL
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "any authenticated user reads permissions" ON public.permissions
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_key)
);
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "any authenticated user reads role_permissions" ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.permissions (key, module, description) VALUES
  ('inventory.view', 'inventory', 'View products, stock levels, categories and warehouses'),
  ('inventory.view_cost', 'inventory', 'See cost price alongside selling price'),
  ('inventory.edit', 'inventory', 'Create/update products, categories and warehouses, and post stock adjustments'),
  ('inventory.delete', 'inventory', 'Delete products, categories and warehouses'),
  ('suppliers.edit', 'suppliers', 'Create/update suppliers'),
  ('suppliers.delete', 'suppliers', 'Delete suppliers'),
  ('purchase_orders.edit', 'purchase_orders', 'Create/update draft purchase orders'),
  ('purchase_orders.approve', 'purchase_orders', 'Approve and send a purchase order to a supplier'),
  ('purchase_orders.receive', 'purchase_orders', 'Record received quantities against a purchase order'),
  ('purchase_orders.delete', 'purchase_orders', 'Delete purchase orders'),
  ('customers.edit', 'customers', 'Create/update customers'),
  ('customers.delete', 'customers', 'Delete customers'),
  ('sales_orders.edit', 'sales_orders', 'Create/update draft sales orders'),
  ('sales_orders.confirm', 'sales_orders', 'Confirm a draft sales order, reserving stock'),
  ('sales_orders.ship', 'sales_orders', 'Ship a confirmed sales order'),
  ('sales_orders.cancel', 'sales_orders', 'Cancel a sales order'),
  ('sales_orders.delete', 'sales_orders', 'Delete sales orders'),
  ('invoices.create', 'invoices', 'Generate a sales invoice from a sales order'),
  ('invoices.edit', 'invoices', 'Update an invoice, such as its payment status'),
  ('invoices.cancel', 'invoices', 'Issue a credit note against an invoice'),
  ('alerts.manage', 'alerts', 'Acknowledge and resolve alerts'),
  ('alerts.delete', 'alerts', 'Delete alerts'),
  ('settings.manage', 'settings', 'Edit the organization''s business and GST profile');

-- Owner and admin: every permission.
INSERT INTO public.role_permissions (role, permission_key)
SELECT r, p.key FROM public.permissions p, unnest(ARRAY['owner', 'admin']) AS r;

-- manager (deprecated, kept for compatibility): everything but org settings.
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'manager', key FROM public.permissions WHERE key <> 'settings.manage';

-- staff (deprecated, kept for compatibility): everything manager has except
-- deletes -- matches the pre-SP-6 behaviour where staff could write/update
-- but only manager+ could delete.
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'staff', key FROM public.permissions
WHERE key NOT IN ('settings.manage', 'inventory.delete', 'suppliers.delete',
                   'purchase_orders.delete', 'customers.delete', 'sales_orders.delete', 'alerts.delete');

INSERT INTO public.role_permissions (role, permission_key) VALUES
  ('inventory_manager', 'inventory.view'),
  ('inventory_manager', 'inventory.view_cost'),
  ('inventory_manager', 'inventory.edit'),
  ('inventory_manager', 'inventory.delete'),
  ('inventory_manager', 'suppliers.edit'),
  ('inventory_manager', 'suppliers.delete'),
  ('inventory_manager', 'purchase_orders.edit'),
  ('inventory_manager', 'purchase_orders.receive'),
  ('inventory_manager', 'alerts.manage'),
  ('inventory_manager', 'alerts.delete'),

  ('procurement_manager', 'inventory.view'),
  ('procurement_manager', 'inventory.view_cost'),
  ('procurement_manager', 'suppliers.edit'),
  ('procurement_manager', 'suppliers.delete'),
  ('procurement_manager', 'purchase_orders.edit'),
  ('procurement_manager', 'purchase_orders.approve'),
  ('procurement_manager', 'purchase_orders.receive'),
  ('procurement_manager', 'purchase_orders.delete'),
  ('procurement_manager', 'alerts.manage'),

  ('sales_manager', 'inventory.view'),
  ('sales_manager', 'inventory.view_cost'),
  ('sales_manager', 'customers.edit'),
  ('sales_manager', 'customers.delete'),
  ('sales_manager', 'sales_orders.edit'),
  ('sales_manager', 'sales_orders.confirm'),
  ('sales_manager', 'sales_orders.ship'),
  ('sales_manager', 'sales_orders.cancel'),
  ('sales_manager', 'sales_orders.delete'),
  ('sales_manager', 'invoices.create'),

  ('accountant', 'inventory.view'),
  ('accountant', 'inventory.view_cost'),
  ('accountant', 'customers.edit'),
  ('accountant', 'invoices.create'),
  ('accountant', 'invoices.edit'),
  ('accountant', 'invoices.cancel'),

  ('warehouse_operator', 'inventory.view'),
  ('warehouse_operator', 'purchase_orders.receive'),
  ('warehouse_operator', 'sales_orders.ship'),
  ('warehouse_operator', 'alerts.manage'),

  ('viewer', 'inventory.view');

-- SECURITY DEFINER so it can read organization_members/role_permissions
-- regardless of the caller's own row visibility, same pattern as
-- is_org_member/has_org_role.
CREATE OR REPLACE FUNCTION public.has_permission(_org UUID, _key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.role_permissions rp ON rp.role = m.role::TEXT
    WHERE m.org_id = _org AND m.user_id = auth.uid() AND rp.permission_key = _key
  );
$$;
REVOKE ALL ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;

-- Organization settings: replace the owner/admin role check with the
-- settings.manage permission (owner and admin are the only roles granted
-- it above, so behaviour is unchanged, but it's now driven by the same
-- permission model as everything else).
DROP POLICY IF EXISTS "admins update org" ON public.organizations;
CREATE POLICY "admins update org" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_permission(id, 'settings.manage'))
  WITH CHECK (public.has_permission(id, 'settings.manage'));

-- Inventory-domain tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['warehouses', 'categories', 'products', 'stock_levels'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org write" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "org write" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, ''inventory.edit''))', t);
    EXECUTE format('CREATE POLICY "org update" ON public.%I FOR UPDATE TO authenticated USING (public.has_permission(org_id, ''inventory.edit'')) WITH CHECK (public.has_permission(org_id, ''inventory.edit''))', t);
    EXECUTE format('CREATE POLICY "org delete" ON public.%I FOR DELETE TO authenticated USING (public.has_permission(org_id, ''inventory.delete''))', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "org write" ON public.suppliers;
DROP POLICY IF EXISTS "org update" ON public.suppliers;
DROP POLICY IF EXISTS "org delete" ON public.suppliers;
CREATE POLICY "org write" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'suppliers.edit'));
CREATE POLICY "org update" ON public.suppliers FOR UPDATE TO authenticated USING (public.has_permission(org_id, 'suppliers.edit')) WITH CHECK (public.has_permission(org_id, 'suppliers.edit'));
CREATE POLICY "org delete" ON public.suppliers FOR DELETE TO authenticated USING (public.has_permission(org_id, 'suppliers.delete'));

-- Stock movements: append-only (no update/delete policy exists), but an
-- insert can come from a manual adjustment or from one of the sales/
-- purchase RPCs below running as the calling user, so any permission that
-- lets someone move stock through those paths must also let them insert
-- the movement row itself.
DROP POLICY IF EXISTS "org write" ON public.stock_movements;
CREATE POLICY "org write" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (
  public.has_permission(org_id, 'inventory.edit')
  OR public.has_permission(org_id, 'purchase_orders.receive')
  OR public.has_permission(org_id, 'sales_orders.confirm')
  OR public.has_permission(org_id, 'sales_orders.ship')
  OR public.has_permission(org_id, 'sales_orders.cancel')
);

-- Alerts.
DROP POLICY IF EXISTS "org write" ON public.alerts;
DROP POLICY IF EXISTS "org update" ON public.alerts;
DROP POLICY IF EXISTS "org delete" ON public.alerts;
CREATE POLICY "org write" ON public.alerts FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'alerts.manage'));
CREATE POLICY "org update" ON public.alerts FOR UPDATE TO authenticated USING (public.has_permission(org_id, 'alerts.manage')) WITH CHECK (public.has_permission(org_id, 'alerts.manage'));
CREATE POLICY "org delete" ON public.alerts FOR DELETE TO authenticated USING (public.has_permission(org_id, 'alerts.delete'));

-- Purchase orders: updating a PO row can mean editing a draft, approving
-- it, or recording a receipt against it -- any of the three purchase_orders
-- permissions can update the row; the RPC/UI layer keeps the actions
-- themselves distinct.
DROP POLICY IF EXISTS "org write" ON public.purchase_orders;
DROP POLICY IF EXISTS "org update" ON public.purchase_orders;
DROP POLICY IF EXISTS "org delete" ON public.purchase_orders;
CREATE POLICY "org write" ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'purchase_orders.edit'));
CREATE POLICY "org update" ON public.purchase_orders FOR UPDATE TO authenticated USING (
  public.has_permission(org_id, 'purchase_orders.edit')
  OR public.has_permission(org_id, 'purchase_orders.approve')
  OR public.has_permission(org_id, 'purchase_orders.receive')
) WITH CHECK (
  public.has_permission(org_id, 'purchase_orders.edit')
  OR public.has_permission(org_id, 'purchase_orders.approve')
  OR public.has_permission(org_id, 'purchase_orders.receive')
);
CREATE POLICY "org delete" ON public.purchase_orders FOR DELETE TO authenticated USING (public.has_permission(org_id, 'purchase_orders.delete'));

DROP POLICY IF EXISTS "org write" ON public.purchase_order_items;
DROP POLICY IF EXISTS "org update" ON public.purchase_order_items;
DROP POLICY IF EXISTS "org delete" ON public.purchase_order_items;
CREATE POLICY "org write" ON public.purchase_order_items FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'purchase_orders.edit'));
CREATE POLICY "org update" ON public.purchase_order_items FOR UPDATE TO authenticated USING (
  public.has_permission(org_id, 'purchase_orders.edit') OR public.has_permission(org_id, 'purchase_orders.receive')
) WITH CHECK (
  public.has_permission(org_id, 'purchase_orders.edit') OR public.has_permission(org_id, 'purchase_orders.receive')
);
CREATE POLICY "org delete" ON public.purchase_order_items FOR DELETE TO authenticated USING (public.has_permission(org_id, 'purchase_orders.delete'));

-- Customers.
DROP POLICY IF EXISTS "org write" ON public.customers;
DROP POLICY IF EXISTS "org update" ON public.customers;
DROP POLICY IF EXISTS "org delete" ON public.customers;
CREATE POLICY "org write" ON public.customers FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'customers.edit'));
CREATE POLICY "org update" ON public.customers FOR UPDATE TO authenticated USING (public.has_permission(org_id, 'customers.edit')) WITH CHECK (public.has_permission(org_id, 'customers.edit'));
CREATE POLICY "org delete" ON public.customers FOR DELETE TO authenticated USING (public.has_permission(org_id, 'customers.delete'));

-- Sales orders: same reasoning as purchase orders -- editing a draft,
-- confirming, shipping and cancelling are all row updates.
DROP POLICY IF EXISTS "org write" ON public.sales_orders;
DROP POLICY IF EXISTS "org update" ON public.sales_orders;
DROP POLICY IF EXISTS "org delete" ON public.sales_orders;
CREATE POLICY "org write" ON public.sales_orders FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'sales_orders.edit'));
CREATE POLICY "org update" ON public.sales_orders FOR UPDATE TO authenticated USING (
  public.has_permission(org_id, 'sales_orders.edit')
  OR public.has_permission(org_id, 'sales_orders.confirm')
  OR public.has_permission(org_id, 'sales_orders.ship')
  OR public.has_permission(org_id, 'sales_orders.cancel')
) WITH CHECK (
  public.has_permission(org_id, 'sales_orders.edit')
  OR public.has_permission(org_id, 'sales_orders.confirm')
  OR public.has_permission(org_id, 'sales_orders.ship')
  OR public.has_permission(org_id, 'sales_orders.cancel')
);
CREATE POLICY "org delete" ON public.sales_orders FOR DELETE TO authenticated USING (public.has_permission(org_id, 'sales_orders.delete'));

DROP POLICY IF EXISTS "org write" ON public.sales_order_items;
DROP POLICY IF EXISTS "org update" ON public.sales_order_items;
DROP POLICY IF EXISTS "org delete" ON public.sales_order_items;
CREATE POLICY "org write" ON public.sales_order_items FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'sales_orders.edit'));
CREATE POLICY "org update" ON public.sales_order_items FOR UPDATE TO authenticated USING (public.has_permission(org_id, 'sales_orders.edit')) WITH CHECK (public.has_permission(org_id, 'sales_orders.edit'));
CREATE POLICY "org delete" ON public.sales_order_items FOR DELETE TO authenticated USING (public.has_permission(org_id, 'sales_orders.delete'));

-- Invoicing.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_invoices', 'sales_invoice_items', 'debit_notes', 'proforma_invoices'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org write" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "org write" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, ''invoices.create''))', t);
    EXECUTE format('CREATE POLICY "org update" ON public.%I FOR UPDATE TO authenticated USING (public.has_permission(org_id, ''invoices.edit'')) WITH CHECK (public.has_permission(org_id, ''invoices.edit''))', t);
    EXECUTE format('CREATE POLICY "org delete" ON public.%I FOR DELETE TO authenticated USING (public.has_permission(org_id, ''invoices.edit''))', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "org write" ON public.credit_notes;
DROP POLICY IF EXISTS "org update" ON public.credit_notes;
DROP POLICY IF EXISTS "org delete" ON public.credit_notes;
CREATE POLICY "org write" ON public.credit_notes FOR INSERT TO authenticated WITH CHECK (public.has_permission(org_id, 'invoices.cancel'));
CREATE POLICY "org update" ON public.credit_notes FOR UPDATE TO authenticated USING (public.has_permission(org_id, 'invoices.cancel')) WITH CHECK (public.has_permission(org_id, 'invoices.cancel'));
CREATE POLICY "org delete" ON public.credit_notes FOR DELETE TO authenticated USING (public.has_permission(org_id, 'invoices.cancel'));

-- Cost-price masking: a security_invoker view so it still respects the
-- underlying products RLS (a plain view owned by the migration role would
-- otherwise run with that role's own products access, bypassing RLS
-- entirely for every viewer of the view -- security_invoker keeps row
-- visibility identical to querying products directly). has_permission()
-- itself resolves auth.uid() from the querying session regardless of the
-- view's invoker setting, so the CASE below reflects the real caller.
CREATE VIEW public.products_safe WITH (security_invoker = true) AS
SELECT
  id, org_id, sku, name, brand, description, category_id, supplier_id, unit, hsn_code, tax_rate,
  CASE WHEN public.has_permission(org_id, 'inventory.view_cost') THEN cost_price ELSE NULL END AS cost_price,
  selling_price, reorder_point, reorder_quantity, barcode, image_url, status, created_at, updated_at
FROM public.products;

GRANT SELECT ON public.products_safe TO authenticated;
GRANT ALL ON public.products_safe TO service_role;
