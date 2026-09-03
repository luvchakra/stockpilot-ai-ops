-- Stock Transfers: Workflow & UI (SP-9).
--
-- SP-3's inventory state model added `in_transit` to stock_levels
-- specifically to prepare for this feature (schema-only until now). This
-- migration adds the transfer tables/workflow and the movement types that
-- actually move stock into and out of in_transit.
--
-- Workflow: draft -> requested -> approved -> in_transit -> received
--   -> completed (cancellable any time before completion). Only the
-- approved->in_transit and in_transit->received/cancelled transitions
-- touch stock -- everything before "in_transit" is a pure workflow state.
--
-- New movement types are prefixed `xfer_` rather than reusing the existing
-- `transfer_in`/`transfer_out` values: those are already exposed as plain
-- manual quantity adjustments in the Inventory page's "record a movement"
-- form (simple on_hand in/out, no in_transit involved), and redefining
-- their semantics would silently change that existing, shipped feature.
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'xfer_ship';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'xfer_arrive';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'xfer_receive';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'xfer_receive_damaged';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'xfer_cancel_ship';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'xfer_cancel_arrive';

CREATE TYPE public.stock_transfer_status AS ENUM (
  'draft', 'requested', 'approved', 'in_transit', 'received', 'completed', 'cancelled'
);

CREATE TABLE public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transfer_number TEXT NOT NULL,
  source_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  destination_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  status public.stock_transfer_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  requested_by UUID NOT NULL DEFAULT auth.uid(),
  approved_by UUID,
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, transfer_number),
  CHECK (destination_warehouse_id <> source_warehouse_id)
);

CREATE TABLE public.stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stock_transfer_id UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  received_quantity NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  damaged_quantity NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_transfers_org ON public.stock_transfers(org_id);
CREATE INDEX idx_stock_transfers_source ON public.stock_transfers(source_warehouse_id);
CREATE INDEX idx_stock_transfers_dest ON public.stock_transfers(destination_warehouse_id);
CREATE INDEX idx_stock_transfer_items_transfer ON public.stock_transfer_items(stock_transfer_id);
CREATE INDEX idx_stock_transfer_items_org ON public.stock_transfer_items(org_id);

CREATE TRIGGER trg_stock_transfers_updated BEFORE UPDATE ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Permission catalog: edit covers draft create/update/request; approve
-- covers approving a request AND shipping it (marking in_transit) since
-- both are the "sending side" of the workflow; receive covers recording
-- receipt and completing; cancel is its own permission since it can undo
-- an in-transit transfer's stock effects.
INSERT INTO public.permissions (key, module, description) VALUES
  ('stock_transfers.edit', 'stock_transfers', 'Create/update draft stock transfers and submit them for approval'),
  ('stock_transfers.approve', 'stock_transfers', 'Approve a requested stock transfer and mark it in transit'),
  ('stock_transfers.receive', 'stock_transfers', 'Record receipt of an in-transit stock transfer and complete it'),
  ('stock_transfers.cancel', 'stock_transfers', 'Cancel a stock transfer, reversing any in-transit stock'),
  ('stock_transfers.delete', 'stock_transfers', 'Delete a draft stock transfer');

INSERT INTO public.role_permissions (role, permission_key) VALUES
  ('owner', 'stock_transfers.edit'), ('owner', 'stock_transfers.approve'),
  ('owner', 'stock_transfers.receive'), ('owner', 'stock_transfers.cancel'),
  ('owner', 'stock_transfers.delete'),
  ('admin', 'stock_transfers.edit'), ('admin', 'stock_transfers.approve'),
  ('admin', 'stock_transfers.receive'), ('admin', 'stock_transfers.cancel'),
  ('admin', 'stock_transfers.delete'),
  ('manager', 'stock_transfers.edit'), ('manager', 'stock_transfers.approve'),
  ('manager', 'stock_transfers.receive'), ('manager', 'stock_transfers.cancel'),
  ('manager', 'stock_transfers.delete'),
  ('staff', 'stock_transfers.edit'), ('staff', 'stock_transfers.approve'),
  ('staff', 'stock_transfers.receive'), ('staff', 'stock_transfers.cancel'),
  ('inventory_manager', 'stock_transfers.edit'), ('inventory_manager', 'stock_transfers.approve'),
  ('inventory_manager', 'stock_transfers.receive'), ('inventory_manager', 'stock_transfers.cancel'),
  ('inventory_manager', 'stock_transfers.delete'),
  ('warehouse_operator', 'stock_transfers.receive');

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_transfers', 'stock_transfer_items'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "org read" ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id))', t);
    EXECUTE format('CREATE POLICY "org delete" ON public.%I FOR DELETE TO authenticated USING (public.has_permission(org_id, ''stock_transfers.delete''))', t);
  END LOOP;
END $$;

CREATE POLICY "org write" ON public.stock_transfers FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'stock_transfers.edit'));
CREATE POLICY "org update" ON public.stock_transfers FOR UPDATE TO authenticated USING (
  public.has_permission(org_id, 'stock_transfers.edit')
  OR public.has_permission(org_id, 'stock_transfers.approve')
  OR public.has_permission(org_id, 'stock_transfers.receive')
  OR public.has_permission(org_id, 'stock_transfers.cancel')
) WITH CHECK (
  public.has_permission(org_id, 'stock_transfers.edit')
  OR public.has_permission(org_id, 'stock_transfers.approve')
  OR public.has_permission(org_id, 'stock_transfers.receive')
  OR public.has_permission(org_id, 'stock_transfers.cancel')
);

CREATE POLICY "org write" ON public.stock_transfer_items FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(org_id, 'stock_transfers.edit'));
CREATE POLICY "org update" ON public.stock_transfer_items FOR UPDATE TO authenticated USING (
  public.has_permission(org_id, 'stock_transfers.edit') OR public.has_permission(org_id, 'stock_transfers.receive')
) WITH CHECK (
  public.has_permission(org_id, 'stock_transfers.edit') OR public.has_permission(org_id, 'stock_transfers.receive')
);

-- Shipping/receiving/cancelling a transfer posts stock_movements rows as
-- the calling user (see the RPCs in the companion migration), so whatever
-- permission lets someone drive that transition must also let them insert
-- the movement row itself -- same reasoning as the existing purchase/sales
-- order clauses already on this policy.
DROP POLICY IF EXISTS "org write" ON public.stock_movements;
CREATE POLICY "org write" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (
  public.has_permission(org_id, 'inventory.edit')
  OR public.has_permission(org_id, 'purchase_orders.receive')
  OR public.has_permission(org_id, 'sales_orders.confirm')
  OR public.has_permission(org_id, 'sales_orders.ship')
  OR public.has_permission(org_id, 'sales_orders.cancel')
  OR public.has_permission(org_id, 'stock_transfers.approve')
  OR public.has_permission(org_id, 'stock_transfers.receive')
  OR public.has_permission(org_id, 'stock_transfers.cancel')
);
