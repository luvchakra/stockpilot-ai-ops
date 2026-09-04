-- Close a permission-model gap found by the first full run of the RLS test
-- suite: the UPDATE RLS policy on purchase_orders/sales_orders/
-- stock_transfers is a blanket OR across every permission relevant to that
-- table (e.g. edit OR approve OR receive OR cancel), because the workflow
-- functions (confirm_sales_order, cancel_sales_order, ship_stock_transfer,
-- receive_stock_transfer_item, cancel_stock_transfer, plus the raw status
-- PATCHes the UI issues directly for PO approve/send/close and transfer
-- submit/approve) are not SECURITY DEFINER and need *some* UPDATE grant on
-- the table to run as the calling user at all.
--
-- None of those functions then check the SPECIFIC permission for the
-- transition they perform -- they only validate business state (draft/
-- confirmed/shipped/etc). So holding *any one* relevant permission on a
-- table was enough to perform *any* status transition on it, including
-- ones gated by a different permission entirely. Concretely, a
-- warehouse_operator (purchase_orders.receive, sales_orders.ship,
-- stock_transfers.receive only) could approve a purchase order, confirm or
-- cancel a sales order, and submit a stock transfer for approval -- none
-- of which its role is supposed to grant.
--
-- Fix: a BEFORE UPDATE trigger per table that maps NEW.status to the
-- specific permission that transition requires, per each page's own
-- documented intent (purchase-orders.tsx's canPrimaryAction, sales-
-- orders.tsx's canRunPrimaryAction, stock-transfers.tsx's
-- canRunPrimaryAction) -- not a guess, the exact mapping the UI itself
-- already enforces client-side, now also enforced server-side regardless
-- of entry point (raw PATCH or RPC).
--
-- service_role is explicitly exempted: RLS's own BYPASSRLS semantics
-- don't extend to trigger execution, so without this guard the seed
-- script (and any future admin tooling) driving status transitions
-- directly as service_role would start failing has_permission() (which
-- needs a real auth.uid()) even though service_role is meant to bypass
-- this class of check entirely, same as it bypasses RLS.

CREATE OR REPLACE FUNCTION public.enforce_po_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'service_role' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'approved', 'sent' THEN
      IF NOT public.has_permission(NEW.org_id, 'purchase_orders.approve') THEN
        RAISE EXCEPTION 'Missing purchase_orders.approve permission for this transition';
      END IF;
    WHEN 'received', 'partially_received' THEN
      IF NOT public.has_permission(NEW.org_id, 'purchase_orders.receive') THEN
        RAISE EXCEPTION 'Missing purchase_orders.receive permission for this transition';
      END IF;
    WHEN 'closed' THEN
      IF NOT (public.has_permission(NEW.org_id, 'purchase_orders.approve')
              OR public.has_permission(NEW.org_id, 'purchase_orders.receive')) THEN
        RAISE EXCEPTION 'Missing permission to close this purchase order';
      END IF;
    ELSE
      -- draft, pending_approval, cancelled: base edit access.
      IF NOT (public.has_permission(NEW.org_id, 'purchase_orders.edit')
              OR public.has_permission(NEW.org_id, 'purchase_orders.approve')) THEN
        RAISE EXCEPTION 'Missing permission for this purchase order status transition';
      END IF;
  END CASE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_po_status_transition BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_po_status_transition();

CREATE OR REPLACE FUNCTION public.enforce_so_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'service_role' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'confirmed' THEN
      IF NOT public.has_permission(NEW.org_id, 'sales_orders.confirm') THEN
        RAISE EXCEPTION 'Missing sales_orders.confirm permission for this transition';
      END IF;
    -- Floor work between confirm and delivery is all gated the same as
    -- shipping itself, matching the Warehouse Operator persona.
    WHEN 'processing', 'packed', 'shipped', 'delivered' THEN
      IF NOT public.has_permission(NEW.org_id, 'sales_orders.ship') THEN
        RAISE EXCEPTION 'Missing sales_orders.ship permission for this transition';
      END IF;
    WHEN 'cancelled', 'returned' THEN
      IF NOT public.has_permission(NEW.org_id, 'sales_orders.cancel') THEN
        RAISE EXCEPTION 'Missing sales_orders.cancel permission for this transition';
      END IF;
    ELSE
      IF NOT public.has_permission(NEW.org_id, 'sales_orders.edit') THEN
        RAISE EXCEPTION 'Missing sales_orders.edit permission for this status transition';
      END IF;
  END CASE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_so_status_transition BEFORE UPDATE ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_so_status_transition();

CREATE OR REPLACE FUNCTION public.enforce_stock_transfer_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'service_role' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'requested' THEN
      IF NOT public.has_permission(NEW.org_id, 'stock_transfers.edit') THEN
        RAISE EXCEPTION 'Missing stock_transfers.edit permission for this transition';
      END IF;
    -- Approving the request and shipping it are both the "sending side"
    -- of the workflow, gated the same, matching the permission catalog's
    -- own description of stock_transfers.approve.
    WHEN 'approved', 'in_transit' THEN
      IF NOT public.has_permission(NEW.org_id, 'stock_transfers.approve') THEN
        RAISE EXCEPTION 'Missing stock_transfers.approve permission for this transition';
      END IF;
    WHEN 'received', 'completed' THEN
      IF NOT public.has_permission(NEW.org_id, 'stock_transfers.receive') THEN
        RAISE EXCEPTION 'Missing stock_transfers.receive permission for this transition';
      END IF;
    WHEN 'cancelled' THEN
      IF NOT public.has_permission(NEW.org_id, 'stock_transfers.cancel') THEN
        RAISE EXCEPTION 'Missing stock_transfers.cancel permission for this transition';
      END IF;
    ELSE
      IF NOT public.has_permission(NEW.org_id, 'stock_transfers.edit') THEN
        RAISE EXCEPTION 'Missing stock_transfers.edit permission for this status transition';
      END IF;
  END CASE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_stock_transfer_status_transition BEFORE UPDATE ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.enforce_stock_transfer_status_transition();
