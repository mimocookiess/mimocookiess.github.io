begin;

/*
 * Correcao do agrupamento de produtos dos Relatorios administrativos.
 *
 * product_slug e a identidade historica estavel. Valores financeiros e
 * quantidades continuam vindo exclusivamente dos snapshots de order_items;
 * public.products.name e usado somente como rotulo canonico de exibicao.
 *
 * Todas as relacoes e funcoes nao pertencentes ao catalogo do PostgreSQL sao
 * qualificadas por schema. COALESCE, NULLIF, EXTRACT, AT TIME ZONE e FILTER
 * sao construcoes da gramatica SQL, nao funcoes resolvidas via search_path.
 *
 * A migration nao altera dados, RLS, policies, indices, triggers ou grants.
 * Rollback conceitual: reaplicar via CREATE OR REPLACE a definicao da migration
 * 20260817193000; nao remover a funcao, pois ela ja existia antes da correcao.
 */
create or replace function public.get_admin_reports(
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
      pg_catalog.count(*) filter (where orders.status = 'completed')::integer
        as completed_orders,
      pg_catalog.count(*) filter (where orders.status = 'cancelled')::integer
        as cancelled_orders,
      coalesce(
        pg_catalog.sum(orders.total) filter (where orders.status = 'completed'),
        0
      )::numeric as revenue,
      coalesce(
        pg_catalog.sum(orders.subtotal) filter (where orders.status = 'completed'),
        0
      )::numeric as product_revenue,
      coalesce(
        pg_catalog.sum(coalesce(orders.delivery_fee, 0))
          filter (where orders.status = 'completed'),
        0
      )::numeric as delivery_fees
    from public.orders
    where orders.created_at >= v_start_at
      and orders.created_at < v_end_at
  ),
  item_totals as (
    select
      coalesce(pg_catalog.sum(order_items.quantity), 0)::bigint as cookies_sold
    from public.orders
    join public.order_items
      on order_items.order_id = orders.id
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
  )
  select pg_catalog.jsonb_build_object(
    'revenue', order_totals.revenue,
    'product_revenue', order_totals.product_revenue,
    'delivery_fees', order_totals.delivery_fees,
    'completed_orders', order_totals.completed_orders,
    'cancelled_orders', order_totals.cancelled_orders,
    'ticket_average', coalesce(
      pg_catalog.round(
        order_totals.revenue /
          nullif(order_totals.completed_orders, 0),
        2
      ),
      0
    ),
    'cookies_sold', item_totals.cookies_sold,
    'cookies_per_order', coalesce(
      pg_catalog.round(
        item_totals.cookies_sold::numeric /
          nullif(order_totals.completed_orders, 0),
        2
      ),
      0
    ),
    'average_product_value', coalesce(
      pg_catalog.round(
        order_totals.product_revenue /
          nullif(item_totals.cookies_sold, 0),
        2
      ),
      0
    ),
    'cancellation_rate', coalesce(
      pg_catalog.round(
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
      pg_catalog.count(*)::integer as orders,
      coalesce(pg_catalog.sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by 1
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
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
      products.name as product_name,
      pg_catalog.sum(order_items.quantity)::bigint as units,
      pg_catalog.count(distinct orders.id)::integer as orders,
      pg_catalog.sum(
        order_items.unit_price * order_items.quantity
      )::numeric as revenue
    from public.orders
    join public.order_items
      on order_items.order_id = orders.id
    join public.products
      on products.id = order_items.product_id
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by order_items.product_slug, products.name
  ),
  product_shares as (
    select
      product_totals.*,
      pg_catalog.sum(product_totals.units) over () as all_units,
      pg_catalog.sum(product_totals.revenue) over () as all_revenue
    from product_totals
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'slug', product_shares.product_slug,
        'name', product_shares.product_name,
        'units', product_shares.units,
        'orders', product_shares.orders,
        'revenue', product_shares.revenue,
        'unit_share', coalesce(
          pg_catalog.round(
            product_shares.units::numeric * 100 /
              nullif(product_shares.all_units, 0),
            2
          ),
          0
        ),
        'revenue_share', coalesce(
          pg_catalog.round(
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
      pg_catalog.count(*)::integer as orders,
      coalesce(pg_catalog.sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by 1
  )
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
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
      pg_catalog.count(*)::integer as orders,
      coalesce(pg_catalog.sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by 1
  )
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
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
      pg_catalog.count(*)::integer as orders,
      coalesce(pg_catalog.sum(orders.total), 0)::numeric as revenue
    from public.orders
    where orders.status = 'completed'
      and orders.created_at >= v_start_at
      and orders.created_at < v_end_at
    group by orders.delivery_method
  ),
  shares as (
    select
      totals.*,
      pg_catalog.sum(totals.orders) over () as all_orders
    from totals
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'method', shares.method,
        'orders', shares.orders,
        'order_share', coalesce(
          pg_catalog.round(
            shares.orders::numeric * 100 /
              nullif(shares.all_orders, 0),
            2
          ),
          0
        ),
        'revenue', shares.revenue,
        'ticket_average', coalesce(
          pg_catalog.round(shares.revenue / nullif(shares.orders, 0), 2),
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
      pg_catalog.sum(order_items.quantity)::bigint as units,
      pg_catalog.sum(order_items.unit_price * order_items.quantity)::numeric
        as item_total
    from public.order_items
    join period_orders
      on period_orders.id = order_items.order_id
    group by order_items.order_id
  )
  select pg_catalog.jsonb_build_object(
    'orders_total', pg_catalog.count(*)::integer,
    'completed_without_timestamp', pg_catalog.count(*) filter (
      where period_orders.status = 'completed'
        and period_orders.completed_at is null
    )::integer,
    'non_completed_with_timestamp', pg_catalog.count(*) filter (
      where period_orders.status <> 'completed'
        and period_orders.completed_at is not null
    )::integer,
    'cancelled_without_timestamp', pg_catalog.count(*) filter (
      where period_orders.status = 'cancelled'
        and period_orders.cancelled_at is null
    )::integer,
    'non_cancelled_with_timestamp', pg_catalog.count(*) filter (
      where period_orders.status <> 'cancelled'
        and period_orders.cancelled_at is not null
    )::integer,
    'orders_without_items', pg_catalog.count(*) filter (
      where item_sums.order_id is null
    )::integer,
    'subtotal_item_mismatches', pg_catalog.count(*) filter (
      where item_sums.order_id is not null
        and period_orders.subtotal is distinct from item_sums.item_total
    )::integer,
    'null_delivery_fees', pg_catalog.count(*) filter (
      where period_orders.delivery_fee is null
    )::integer
  )
  into v_audit
  from period_orders
  left join item_sums
    on item_sums.order_id = period_orders.id;

  return pg_catalog.jsonb_build_object(
    'period', pg_catalog.jsonb_build_object(
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

