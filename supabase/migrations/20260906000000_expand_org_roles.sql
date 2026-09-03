-- Granular Roles & Permissions (SP-6), part 1: expand org_role with the
-- PRD's eight-role model (owner, admin, inventory_manager,
-- procurement_manager, sales_manager, accountant, warehouse_operator,
-- viewer). Split into its own migration because Postgres will not let a
-- newly added enum value be referenced in the same transaction that adds
-- it (part 2 seeds role_permissions rows for these values).
--
-- 'manager' and 'staff' are left in the type, unused: a live audit before
-- this change found zero organization_members rows assigned either role,
-- so nothing needs migrating off them, and a full enum rebuild (which
-- would touch every policy and function signature typed against
-- org_role) buys nothing a comment doesn't already cover.
COMMENT ON TYPE public.org_role IS
  'Roles: owner, admin, inventory_manager, procurement_manager, sales_manager, accountant, warehouse_operator, viewer. '
  '''manager'' and ''staff'' are deprecated -- kept for compatibility with the enum''s history, never assigned to new members. '
  'See role_permissions for the permission set each active role carries.';

ALTER TYPE public.org_role ADD VALUE 'inventory_manager';
ALTER TYPE public.org_role ADD VALUE 'procurement_manager';
ALTER TYPE public.org_role ADD VALUE 'sales_manager';
ALTER TYPE public.org_role ADD VALUE 'accountant';
ALTER TYPE public.org_role ADD VALUE 'warehouse_operator';
