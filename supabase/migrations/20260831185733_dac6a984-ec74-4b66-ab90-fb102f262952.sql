REVOKE ALL ON FUNCTION public.check_stock_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_non_owner_plan_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receive_purchase_order_item(uuid, numeric) FROM PUBLIC, anon;