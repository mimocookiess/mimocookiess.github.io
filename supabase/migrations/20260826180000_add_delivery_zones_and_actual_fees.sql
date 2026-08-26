begin;

/*
 * Frete automatico por bairro e custo real de entrega.
 *
 * Pedidos historicos permanecem intocados: nenhum bairro ou frete e inferido
 * do endereco livre. Os snapshots passam a ser obrigatorios apenas pelo fluxo
 * de criacao de novos pedidos.
 *
 * Rollback de schema: remover as novas RPCs, remover as duas colunas de orders
 * e remover delivery_zones. Antes de qualquer rollback em producao, preservar os
 * snapshots de frete e os custos reais, pois remover as colunas perde dados.
 */

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint delivery_zones_name_check
    check (char_length(trim(name)) between 1 and 100),
  slug text not null unique
    constraint delivery_zones_slug_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  fee numeric(10, 2) not null
    constraint delivery_zones_fee_check
    check (fee >= 0),
  active boolean not null default true,
  source text not null
    constraint delivery_zones_source_check
    check (source in ('manual_verified', 'distance_estimated', 'pdf_table')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_zones_active_sort_order_idx
on public.delivery_zones (active, sort_order, name);

create trigger set_delivery_zones_updated_at
before update on public.delivery_zones
for each row
execute function public.set_updated_at();

alter table public.delivery_zones enable row level security;

revoke all on table public.delivery_zones
from public, anon, authenticated, service_role;

insert into public.delivery_zones (name, slug, fee, active, source, sort_order)
values
  ('Aeroporto Velho', 'aeroporto-velho', 7.00, true, 'manual_verified', 1),
  ('Aldeia', 'aldeia', 9.00, true, 'manual_verified', 2),
  ('Alvorada', 'alvorada', 17.00, true, 'manual_verified', 3),
  ('Amparo', 'amparo', 16.20, true, 'pdf_table', 4),
  ('Aparecida', 'aparecida', 7.20, true, 'pdf_table', 5),
  ('Área Verde', 'area-verde', 10.00, true, 'manual_verified', 6),
  ('Cambuquira', 'cambuquira', 17.00, true, 'pdf_table', 7),
  ('Caranazal', 'caranazal', 9.00, true, 'manual_verified', 8),
  ('Centro', 'centro', 8.00, true, 'manual_verified', 9),
  ('Cidade Jardim', 'cidade-jardim', 14.40, true, 'distance_estimated', 10),
  ('Conquista', 'conquista', 16.20, true, 'pdf_table', 11),
  ('Diamantino', 'diamantino', 8.00, true, 'manual_verified', 12),
  ('Elcione Barbalho', 'elcione-barbalho', 16.00, true, 'manual_verified', 13),
  ('Esperança', 'esperanca', 7.00, true, 'pdf_table', 14),
  ('Espírito Santo', 'espirito-santo', 12.60, true, 'distance_estimated', 15),
  ('Fátima', 'fatima', 8.00, true, 'manual_verified', 16),
  ('Floresta', 'floresta', 9.00, true, 'manual_verified', 17),
  ('Interventoria', 'interventoria', 7.00, true, 'manual_verified', 18),
  ('Ipanema', 'ipanema', 16.20, true, 'pdf_table', 19),
  ('Jaderlândia', 'jaderlandia', 14.40, true, 'pdf_table', 20),
  ('Jardim Santarém', 'jardim-santarem', 7.00, true, 'manual_verified', 21),
  ('Juá', 'jua', 12.60, true, 'distance_estimated', 22),
  ('Jutaí', 'jutai', 16.20, true, 'pdf_table', 23),
  ('Laguinho', 'laguinho', 9.00, true, 'pdf_table', 24),
  ('Liberdade', 'liberdade', 7.20, true, 'pdf_table', 25),
  ('Livramento', 'livramento', 17.00, true, 'pdf_table', 26),
  ('Maicá', 'maica', 16.20, true, 'pdf_table', 27),
  ('Mapiri', 'mapiri', 12.00, true, 'manual_verified', 28),
  ('Maracanã', 'maracana', 17.00, true, 'pdf_table', 29),
  ('Maracanã I', 'maracana-i', 17.00, true, 'pdf_table', 30),
  ('Mararú', 'mararu', 17.00, true, 'pdf_table', 31),
  ('Matinha', 'matinha', 16.20, true, 'pdf_table', 32),
  ('Nova Jerusalém', 'nova-jerusalem', 14.40, true, 'distance_estimated', 33),
  ('Nova República', 'nova-republica', 12.60, true, 'pdf_table', 34),
  ('Nova Vitória', 'nova-vitoria', 17.00, true, 'pdf_table', 35),
  ('Novo Horizonte', 'novo-horizonte', 17.00, true, 'pdf_table', 36),
  ('Pérola do Maicá', 'perola-do-maica', 17.00, true, 'pdf_table', 37),
  ('Prainha', 'prainha', 7.00, true, 'manual_verified', 38),
  ('Salé', 'sale', 9.00, true, 'pdf_table', 39),
  ('Santa Clara', 'santa-clara', 8.00, true, 'manual_verified', 40),
  ('Santana', 'santana', 9.00, true, 'manual_verified', 41),
  ('Santarenzinho', 'santarenzinho', 14.40, true, 'pdf_table', 42),
  ('Santíssimo', 'santissimo', 8.00, true, 'manual_verified', 43),
  ('Santo André', 'santo-andre', 14.40, true, 'pdf_table', 44),
  ('São Cristóvão', 'sao-cristovao', 17.00, true, 'pdf_table', 45),
  ('São Francisco', 'sao-francisco', 14.40, true, 'pdf_table', 46),
  ('São José Operário', 'sao-jose-operario', 12.60, true, 'pdf_table', 47),
  ('Uruará', 'uruara', 8.00, true, 'manual_verified', 48),
  ('Urumanduba', 'urumanduba', 17.00, true, 'pdf_table', 49),
  ('Urumari', 'urumari', 9.00, true, 'manual_verified', 50),
  ('Vigia', 'vigia', 17.00, true, 'pdf_table', 51),
  ('Vitória Régia', 'vitoria-regia', 17.00, true, 'pdf_table', 52);

alter table public.orders
add column delivery_neighborhood text
  constraint orders_delivery_neighborhood_check
  check (
    delivery_neighborhood is null
    or char_length(trim(delivery_neighborhood)) between 1 and 100
  ),
add column delivery_actual_fee numeric(10, 2)
  constraint orders_delivery_actual_fee_check
  check (delivery_actual_fee is null or delivery_actual_fee >= 0);

create function public.list_delivery_zones()
returns table (
  slug text,
  name text,
  fee numeric(10, 2)
)
language sql
stable
security definer
set search_path = ''
as $$
  select delivery_zones.slug, delivery_zones.name, delivery_zones.fee
  from public.delivery_zones
  where delivery_zones.active = true
  order by delivery_zones.sort_order, delivery_zones.name;
$$;

comment on function public.list_delivery_zones() is
  'Lista publica somente de leitura das zonas de entrega ativas.';

revoke all on function public.list_delivery_zones()
from public, anon, authenticated, service_role;

grant execute on function public.list_delivery_zones()
to anon, authenticated, service_role;

/*
 * A assinatura anterior continua temporariamente disponivel apenas ao
 * service_role para permitir rollout sem indisponibilidade. Ela tambem preserva
 * em um unico lugar a validacao de produtos, estoque e a arbitragem concorrente
 * do checkout_attempt_id. Nenhuma role cliente pode executa-la diretamente.
 */
revoke all on function public.create_order(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text,
  text
)
from public, anon, authenticated, service_role;

grant execute on function public.create_order(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text,
  text
)
to service_role;

revoke all on function public.create_order(
  text,
  text,
  text,
  text,
  text,
  jsonb
)
from public, anon, authenticated, service_role;

create function public.create_order(
  p_customer_name text,
  p_delivery_method text,
  p_payment_method text,
  p_customer_address text,
  p_notes text,
  p_items jsonb,
  p_checkout_attempt_id uuid,
  p_ga_client_id text,
  p_ga_session_id text,
  p_delivery_neighborhood_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_internal_result jsonb;
  v_delivery_neighborhood text;
  v_delivery_fee numeric(10, 2);
begin
  if p_checkout_attempt_id is null then
    raise exception 'Identificador de tentativa invalido.';
  end if;

  /* Um retry sempre devolve o snapshot original, mesmo se a tarifa mudou. */
  select *
  into v_order
  from public.orders
  where checkout_attempt_id = p_checkout_attempt_id;

  if found then
    return jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'subtotal', v_order.subtotal,
      'delivery_fee', coalesce(v_order.delivery_fee, 0),
      'total', v_order.total,
      'payment_method', v_order.payment_method,
      'payment_status', v_order.payment_status,
      'delivery_neighborhood', v_order.delivery_neighborhood
    );
  end if;

  p_delivery_method := trim(p_delivery_method);
  p_delivery_neighborhood_slug :=
    nullif(trim(p_delivery_neighborhood_slug), '');

  if p_delivery_method = 'Entrega' then
    if p_delivery_neighborhood_slug is null
       or char_length(p_delivery_neighborhood_slug) > 100 then
      raise exception 'Selecione um bairro de entrega valido.';
    end if;

    select delivery_zones.name, delivery_zones.fee
    into v_delivery_neighborhood, v_delivery_fee
    from public.delivery_zones
    where delivery_zones.slug = p_delivery_neighborhood_slug
      and delivery_zones.active = true;

    if not found then
      raise exception 'Bairro de entrega invalido ou indisponivel.';
    end if;
  elsif p_delivery_method = 'Retirada' then
    v_delivery_neighborhood := null;
    v_delivery_fee := 0;
  end if;

  v_internal_result := public.create_order(
    p_customer_name,
    p_delivery_method,
    p_payment_method,
    p_customer_address,
    p_notes,
    p_items,
    p_checkout_attempt_id,
    p_ga_client_id,
    p_ga_session_id
  );

  select *
  into v_order
  from public.orders
  where id = (v_internal_result ->> 'id')::uuid
  for update;

  if not found then
    raise exception 'Nao foi possivel recuperar o pedido criado.';
  end if;

  if v_order.delivery_fee is null then
    update public.orders
    set
      delivery_neighborhood = v_delivery_neighborhood,
      delivery_fee = v_delivery_fee
    where id = v_order.id
    returning * into v_order;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'subtotal', v_order.subtotal,
    'delivery_fee', coalesce(v_order.delivery_fee, 0),
    'total', v_order.total,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'delivery_neighborhood', v_order.delivery_neighborhood
  );
end;
$$;

revoke all on function public.create_order(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text,
  text,
  text
)
from public, anon, authenticated, service_role;

grant execute on function public.create_order(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text,
  text,
  text
)
to service_role;

create function public.set_order_actual_delivery_fee(
  p_order_id uuid,
  p_actual_fee numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_user_id constant uuid :=
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid;
  v_order public.orders%rowtype;
begin
  if auth.uid() is distinct from v_admin_user_id then
    raise exception 'Acesso administrativo nao autorizado.'
      using errcode = '42501';
  end if;

  if p_actual_fee is null or p_actual_fee < 0 then
    raise exception 'O frete real deve ser um valor maior ou igual a zero.'
      using errcode = '22023';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido nao encontrado.' using errcode = 'P0002';
  end if;

  if v_order.delivery_method <> 'Entrega' then
    raise exception 'Frete real so pode ser informado para entrega.'
      using errcode = '22023';
  end if;

  update public.orders
  set delivery_actual_fee = p_actual_fee
  where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'id', v_order.id,
    'delivery_fee', coalesce(v_order.delivery_fee, 0),
    'delivery_actual_fee', v_order.delivery_actual_fee,
    'difference', v_order.delivery_actual_fee - coalesce(v_order.delivery_fee, 0)
  );
end;
$$;

revoke all on function public.set_order_actual_delivery_fee(uuid, numeric)
from public, anon, authenticated, service_role;

grant execute on function public.set_order_actual_delivery_fee(uuid, numeric)
to authenticated;

/* Status de pedidos ja e alterado por RPCs dedicadas; remove o grant legado. */
revoke update on table public.orders from authenticated;

commit;
