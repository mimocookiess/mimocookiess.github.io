begin;

/*
 * Dashboard administrativo de Relatorios.
 *
 * A funcao retorna somente agregados sem PII e valida o mesmo UUID
 * administrativo usado pelas policies atuais. Datas recebidas sao datas de
 * calendario da loja; o intervalo final e inclusivo e convertido para
 * America/Santarem antes de consultar os timestamptz armazenados em UTC.
 *
 * Rollback de schema: drop function public.get_admin_reports(date, date).
 * A migration nao altera dados existentes e nao exige backup de dados.
 */
create function public.get_admin_reports(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin_user_id constant uuid :=
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid;
  v_timezone constant text := 'America/Santarem';
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_summary jsonb;
  v_daily jsonb;
  v_products jsonb;
  v_weekdays jsonb;
  v_hours jsonb;
  v_fulfillment jsonb;
  v_audit jsonb;
begin
  if auth.uid() is distinct from v_admin_user_id then
    raise exception 'Acesso nao autorizado.'
      using errcode = '42501';
  end if;

  if p_start_date is null
     or p_end_date is null
     or p_start_date > p_end_date then
    raise exception 'Periodo invalido.'
      using errcode = '22007';
  end if;

  if p_end_date - p_start_date > 3660 then
    raise exception 'O periodo nao pode exceder 10 anos.'
      using errcode = '22023';
  end if;

  v_start_at := p_start_date::timestamp at time zone v_timezone;
  v_end_at := (p_end_date + 1)::timestamp at time zone v_timezone;

  with order_totals as (
    select
      count(*) filter (where orders.status = 'completed')::integer
        as completed_orders,
      count(*) filter (where orders.status = 'cancelled')::integer
        as cancelled_orders,
      coalesce(
        sum(orders.total) filter (where orders.status = 'completed'),
        0
      )::numeric as revenue,
      coalesce(
        sum(orders.subtotal) filter (where orders.status = 'completed'),
        0
      )::numeric as product_revenue,
      coalesce(
        sum(coalesce(orders.delivery_fee, 0))
          filter (where orders.status = 'completed'),
        0
      )::numeric as delivery_fees
    from public.orders
    where orders.created_at >= v_start_at
      and orders.created_at < v_end_at
  ),
  item_totals as (
    select
      coalesce(sum(order_items.quantity), 0)::bigint as cookies_sold
    from public.orders
    join public.order_items
      on order_items.order_id = orders.id
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
  )
  select jsonb_build_object(
    'revenue', order_totals.revenue,
    'product_revenue', order_totals.product_revenue,
    'delivery_fees', order_totals.delivery_fees,
    'completed_orders', order_totals.completed_orders,
    'cancelled_orders', order_totals.cancelled_orders,
    'ticket_average', coalesce(
      round(
        order_totals.revenue /
          nullif(order_totals.completed_orders, 0),
        2
      ),
      0
    ),
    'cookies_sold', item_totals.cookies_sold,
    'cookies_per_order', coalesce(
      round(
        item_totals.cookies_sold::numeric /
          nullif(order_totals.completed_orders, 0),
        2
      ),
      0
    ),
    'average_product_value', coalesce(
      round(
        order_totals.product_revenue /
          nullif(item_totals.cookies_sold, 0),
        2
      ),
      0
    ),
    'cancellation_rate', coalesce(
      round(
        order_totals.cancelled_orders::numeric * 100 /
          nullif(
            order_totals.completed_orders + order_totals.cancelled_orders,
            0
          ),
        2
      ),
      0
    )
  )
  into v_summary
  from order_totals
  cross join item_totals;

  with days as (
    select day_value::date as day
    from pg_catalog.generate_series(
      p_start_date::timestamp,
      p_end_date::timestamp,
      interval '1 day'
    ) as day_value
  ),
  totals as (
    select
      (orders.created_at at time zone v_timezone)::date as day,
      count(*)::integer as orders,
      coalesce(sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', days.day,
        'orders', coalesce(totals.orders, 0),
        'revenue', coalesce(totals.revenue, 0)
      )
      order by days.day
    ),
    '[]'::jsonb
  )
  into v_daily
  from days
  left join totals using (day);

  with product_totals as (
    select
      order_items.product_slug,
      order_items.product_name,
      sum(order_items.quantity)::bigint as units,
      count(distinct orders.id)::integer as orders,
      sum(order_items.unit_price * order_items.quantity)::numeric as revenue
    from public.orders
    join public.order_items
      on order_items.order_id = orders.id
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by order_items.product_slug, order_items.product_name
  ),
  product_shares as (
    select
      product_totals.*,
      sum(product_totals.units) over () as all_units,
      sum(product_totals.revenue) over () as all_revenue
    from product_totals
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slug', product_shares.product_slug,
        'name', product_shares.product_name,
        'units', product_shares.units,
        'orders', product_shares.orders,
        'revenue', product_shares.revenue,
        'unit_share', coalesce(
          round(
            product_shares.units::numeric * 100 /
              nullif(product_shares.all_units, 0),
            2
          ),
          0
        ),
        'revenue_share', coalesce(
          round(
            product_shares.revenue * 100 /
              nullif(product_shares.all_revenue, 0),
            2
          ),
          0
        )
      )
      order by
        product_shares.units desc,
        product_shares.revenue desc,
        product_shares.product_name
    ),
    '[]'::jsonb
  )
  into v_products
  from product_shares;

  with weekday_numbers as (
    select pg_catalog.generate_series(1, 7)::integer as weekday
  ),
  totals as (
    select
      extract(
        isodow from orders.created_at at time zone v_timezone
      )::integer as weekday,
      count(*)::integer as orders,
      coalesce(sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by 1
  )
  select jsonb_agg(
    jsonb_build_object(
      'weekday', weekday_numbers.weekday,
      'orders', coalesce(totals.orders, 0),
      'revenue', coalesce(totals.revenue, 0)
    )
    order by weekday_numbers.weekday
  )
  into v_weekdays
  from weekday_numbers
  left join totals using (weekday);

  with hour_numbers as (
    select pg_catalog.generate_series(0, 23)::integer as hour
  ),
  totals as (
    select
      extract(
        hour from orders.created_at at time zone v_timezone
      )::integer as hour,
      count(*)::integer as orders,
      coalesce(sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by 1
  )
  select jsonb_agg(
    jsonb_build_object(
      'hour', hour_numbers.hour,
      'orders', coalesce(totals.orders, 0),
      'revenue', coalesce(totals.revenue, 0)
    )
    order by hour_numbers.hour
  )
  into v_hours
  from hour_numbers
  left join totals using (hour);

  with totals as (
    select
      orders.delivery_method as method,
      count(*)::integer as orders,
      coalesce(sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by orders.delivery_method
  ),
  shares as (
    select
      totals.*,
      sum(totals.orders) over () as all_orders
    from totals
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'method', shares.method,
        'orders', shares.orders,
        'order_share', coalesce(
          round(
            shares.orders::numeric * 100 /
              nullif(shares.all_orders, 0),
            2
          ),
          0
        ),
        'revenue', shares.revenue,
        'ticket_average', coalesce(
          round(shares.revenue / nullif(shares.orders, 0), 2),
          0
        )
      )
      order by shares.orders desc, shares.method
    ),
    '[]'::jsonb
  )
  into v_fulfillment
  from shares;

  with period_orders as (
    select orders.*
    from public.orders
    where orders.created_at >= v_start_at
      and orders.created_at < v_end_at
  ),
  item_sums as (
    select
      order_items.order_id,
      sum(order_items.quantity)::bigint as units,
      sum(order_items.unit_price * order_items.quantity)::numeric
        as item_total
    from public.order_items
    join period_orders
      on period_orders.id = order_items.order_id
    group by order_items.order_id
  )
  select jsonb_build_object(
    'orders_total', count(*)::integer,
    'completed_without_timestamp', count(*) filter (
      where period_orders.status = 'completed'
        and period_orders.completed_at is null
    )::integer,
    'non_completed_with_timestamp', count(*) filter (
      where period_orders.status <> 'completed'
        and period_orders.completed_at is not null
    )::integer,
    'cancelled_without_timestamp', count(*) filter (
      where period_orders.status = 'cancelled'
        and period_orders.cancelled_at is null
    )::integer,
    'non_cancelled_with_timestamp', count(*) filter (
      where period_orders.status <> 'cancelled'
        and period_orders.cancelled_at is not null
    )::integer,
    'orders_without_items', count(*) filter (
      where item_sums.order_id is null
    )::integer,
    'subtotal_item_mismatches', count(*) filter (
      where item_sums.order_id is not null
        and period_orders.subtotal is distinct from item_sums.item_total
    )::integer,
    'null_delivery_fees', count(*) filter (
      where period_orders.delivery_fee is null
    )::integer
  )
  into v_audit
  from period_orders
  left join item_sums
    on item_sums.order_id = period_orders.id;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date,
      'start_at', v_start_at,
      'end_at_exclusive', v_end_at,
      'timezone', v_timezone,
      'date_basis', 'created_at'
    ),
    'summary', v_summary,
    'daily', v_daily,
    'products', v_products,
    'weekdays', v_weekdays,
    'hours', v_hours,
    'fulfillment', v_fulfillment,
    'audit', v_audit
  );
end;
$$;

comment on function public.get_admin_reports(date, date) is
  'Retorna apenas agregados administrativos sem PII para o periodo local.';

revoke all on function public.get_admin_reports(date, date)
from public, anon, authenticated, service_role;

grant execute on function public.get_admin_reports(date, date)
to authenticated;

commit;
