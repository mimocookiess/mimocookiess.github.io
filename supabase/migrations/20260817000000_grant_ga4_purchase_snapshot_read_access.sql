begin;

/*
 * The GA4 purchase worker reads only the immutable financial/order snapshot.
 * Column-level grants keep customer PII unavailable to its service-role client.
 */
grant select (
  id,
  order_number,
  subtotal,
  delivery_fee,
  total,
  status,
  completed_at,
  ga_client_id,
  ga_session_id
)
on table public.orders
to service_role;

grant select (
  order_id,
  product_slug,
  product_name,
  unit_price,
  quantity
)
on table public.order_items
to service_role;

commit;
