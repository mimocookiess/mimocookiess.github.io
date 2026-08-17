begin;

/*
 * Bootstrap exclusivamente local.
 *
 * Representa o schema public imediatamente anterior a
 * 20260802000000_restrict_create_order_execution.sql. Este arquivo fica fora
 * de supabase/migrations para nunca ser considerado por db push --linked.
 * Nao contem dados, usuarios de Auth, objetos de Storage ou secrets.
 */

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  price numeric(10, 2) not null
    constraint products_price_check check (price >= 0),
  description text not null default '',
  image_url text not null,
  available boolean not null default true,
  stock integer
    constraint products_stock_check check (stock is null or stock >= 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_name text not null
    constraint orders_customer_name_check
    check (char_length(customer_name) between 2 and 100),
  delivery_method text not null
    constraint orders_delivery_method_check
    check (delivery_method in ('Retirada', 'Entrega')),
  payment_method text not null
    constraint orders_payment_method_check
    check (
      payment_method in (
        'Pix',
        'Cartão de crédito',
        'Cartão de débito'
      )
    ),
  payment_status text not null default 'pending'
    constraint orders_payment_status_check
    check (payment_status in ('pending', 'paid', 'refunded', 'cancelled')),
  customer_address text,
  notes text
    constraint orders_notes_check
    check (notes is null or char_length(notes) <= 500),
  subtotal numeric(10, 2) not null
    constraint orders_subtotal_check check (subtotal >= 0),
  delivery_fee numeric(10, 2)
    constraint orders_delivery_fee_check
    check (delivery_fee is null or delivery_fee >= 0),
  total numeric(10, 2) generated always as (
    subtotal + coalesce(delivery_fee, 0)
  ) stored,
  status text not null default 'new'
    constraint orders_status_check
    check (
      status in (
        'new',
        'confirmed',
        'preparing',
        'ready',
        'completed',
        'cancelled'
      )
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  paid_at timestamptz
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null
    constraint order_items_order_id_fkey
    references public.orders(id)
    on delete cascade,
  product_id uuid not null
    constraint order_items_product_id_fkey
    references public.products(id),
  product_slug text not null,
  product_name text not null,
  unit_price numeric(10, 2) not null
    constraint order_items_unit_price_check check (unit_price >= 0),
  quantity integer not null
    constraint order_items_quantity_check check (quantity > 0),
  line_total numeric(10, 2) generated always as (
    unit_price * quantity
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index order_items_order_id_idx
on public.order_items (order_id);

create index order_items_product_id_idx
on public.order_items (product_id);

create index order_items_product_slug_idx
on public.order_items (product_slug);

create index orders_customer_name_idx
on public.orders (customer_name);

create index orders_payment_method_idx
on public.orders (payment_method);

create index orders_payment_status_idx
on public.orders (payment_status);

create index orders_status_created_at_idx
on public.orders (status, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_orders_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

create trigger set_order_items_updated_at
before update on public.order_items
for each row
execute function public.set_updated_at();

create function public.create_order(
  p_customer_name text,
  p_delivery_method text,
  p_payment_method text,
  p_customer_address text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_subtotal numeric(10, 2) := 0;
  v_item jsonb;
  v_grouped_item record;
  v_normalized_items jsonb := '[]'::jsonb;
  v_validated_items jsonb := '[]'::jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
begin
  p_customer_name := trim(p_customer_name);
  p_delivery_method := trim(p_delivery_method);
  p_payment_method := trim(p_payment_method);
  p_customer_address := nullif(trim(p_customer_address), '');
  p_notes := nullif(trim(p_notes), '');

  if p_customer_name is null
     or char_length(p_customer_name) not between 2 and 100 then
    raise exception 'Nome inválido.';
  end if;

  if p_delivery_method is null
     or p_delivery_method not in ('Retirada', 'Entrega') then
    raise exception 'Forma de recebimento inválida.';
  end if;

  if p_payment_method is null
     or p_payment_method not in (
       'Pix',
       'Cartão de crédito',
       'Cartão de débito'
     ) then
    raise exception 'Forma de pagamento inválida.';
  end if;

  if p_delivery_method = 'Entrega'
     and p_customer_address is null then
    raise exception 'O endereço é obrigatório para entrega.';
  end if;

  if p_customer_address is not null
     and char_length(p_customer_address) > 300 then
    raise exception 'O endereço deve ter no máximo 300 caracteres.';
  end if;

  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception 'As observações devem ter no máximo 500 caracteres.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 20 then
    raise exception 'Lista de produtos inválida.';
  end if;

  for v_item in
    select item.value
    from jsonb_array_elements(p_items) as item(value)
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception
      when others then
        raise exception 'Quantidade inválida.';
    end;

    if v_quantity is null then
      raise exception 'Quantidade inválida.';
    end if;

    v_normalized_items := v_normalized_items || jsonb_build_array(
      jsonb_build_object(
        'slug', v_item ->> 'slug',
        'quantity', v_quantity
      )
    );
  end loop;

  for v_grouped_item in
    select
      item.value ->> 'slug' as slug,
      sum((item.value ->> 'quantity')::integer)::bigint as total_quantity
    from jsonb_array_elements(v_normalized_items) as item(value)
    group by item.value ->> 'slug'
    order by item.value ->> 'slug'
  loop
    if v_grouped_item.total_quantity < 1
       or v_grouped_item.total_quantity > 50 then
      raise exception 'Quantidade inválida.';
    end if;

    select *
    into v_product
    from public.products
    where slug = v_grouped_item.slug;

    if not found then
      raise exception 'Produto não encontrado.';
    end if;

    if not v_product.available then
      raise exception 'O produto % está indisponível.', v_product.name;
    end if;

    if v_product.stock is not null
       and v_grouped_item.total_quantity > v_product.stock then
      raise exception
        'Há somente % unidade(s) disponível(is) de %.',
        v_product.stock,
        v_product.name;
    end if;

    v_subtotal :=
      v_subtotal + (v_product.price * v_grouped_item.total_quantity);

    v_validated_items := v_validated_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'slug', v_product.slug,
        'name', v_product.name,
        'price', v_product.price,
        'total_quantity', v_grouped_item.total_quantity
      )
    );
  end loop;

  insert into public.orders (
    customer_name,
    delivery_method,
    payment_method,
    payment_status,
    customer_address,
    notes,
    subtotal
  )
  values (
    p_customer_name,
    p_delivery_method,
    p_payment_method,
    'pending',
    p_customer_address,
    p_notes,
    v_subtotal
  )
  returning id, order_number
  into v_order_id, v_order_number;

  for v_item in
    select item.value
    from jsonb_array_elements(v_validated_items) as item(value)
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_slug,
      product_name,
      unit_price,
      quantity
    )
    values (
      v_order_id,
      (v_item ->> 'product_id')::uuid,
      v_item ->> 'slug',
      v_item ->> 'name',
      (v_item ->> 'price')::numeric,
      (v_item ->> 'total_quantity')::integer
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'payment_method', p_payment_method,
    'payment_status', 'pending'
  );
end;
$$;

create function public.confirm_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id constant uuid :=
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid;
  v_order public.orders%rowtype;
  v_item record;
  v_product public.products%rowtype;
begin
  if auth.uid() is null or auth.uid() <> v_admin_id then
    raise exception 'Acesso administrativo não autorizado.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_order.status = 'confirmed' then
    return jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'status', v_order.status,
      'message', 'Pedido já estava confirmado.'
    );
  end if;

  if v_order.status <> 'new' then
    raise exception
      'Somente pedidos novos podem ser confirmados. Status atual: %.',
      v_order.status;
  end if;

  for v_item in
    select
      oi.product_id,
      sum(oi.quantity)::integer as total_quantity
    from public.order_items oi
    where oi.order_id = p_order_id
    group by oi.product_id
    order by oi.product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    if not found then
      raise exception 'Um produto do pedido não foi encontrado.';
    end if;

    if not v_product.available then
      raise exception 'O produto % está indisponível.', v_product.name;
    end if;

    if v_product.stock is not null
       and v_product.stock < v_item.total_quantity then
      raise exception
        'Estoque insuficiente de %. Disponível: %. Solicitado: %.',
        v_product.name,
        v_product.stock,
        v_item.total_quantity;
    end if;
  end loop;

  update public.products p
  set stock = p.stock - grouped.total_quantity
  from (
    select
      oi.product_id,
      sum(oi.quantity)::integer as total_quantity
    from public.order_items oi
    where oi.order_id = p_order_id
    group by oi.product_id
  ) grouped
  where p.id = grouped.product_id
    and p.stock is not null;

  update public.orders
  set status = 'confirmed', confirmed_at = now()
  where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'confirmed_at', v_order.confirmed_at
  );
end;
$$;

create function public.cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id constant uuid :=
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid;
  v_order public.orders%rowtype;
  v_stock_was_deducted boolean := false;
begin
  if auth.uid() is null or auth.uid() <> v_admin_id then
    raise exception 'Acesso administrativo não autorizado.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'status', v_order.status,
      'message', 'Pedido já estava cancelado.'
    );
  end if;

  if v_order.status = 'completed' then
    raise exception 'Um pedido concluído não pode ser cancelado.';
  end if;

  v_stock_was_deducted :=
    v_order.status in ('confirmed', 'preparing', 'ready');

  if v_stock_was_deducted then
    perform p.id
    from public.products p
    join public.order_items oi on oi.product_id = p.id
    where oi.order_id = p_order_id
    order by p.id
    for update of p;

    update public.products p
    set stock = p.stock + grouped.total_quantity
    from (
      select
        oi.product_id,
        sum(oi.quantity)::integer as total_quantity
      from public.order_items oi
      where oi.order_id = p_order_id
      group by oi.product_id
    ) grouped
    where p.id = grouped.product_id
      and p.stock is not null;
  end if;

  update public.orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'stock_restored', v_stock_was_deducted,
    'cancelled_at', v_order.cancelled_at
  );
end;
$$;

revoke all on function public.confirm_order(uuid) from public, anon;
grant execute on function public.confirm_order(uuid) to authenticated;

revoke all on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "Publico pode visualizar produtos"
on public.products
for select
to anon, authenticated
using (true);

create policy "Administrador pode adicionar produtos"
on public.products
for insert
to authenticated
with check (
  auth.uid() = 'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
);

create policy "Administrador pode editar produtos"
on public.products
for update
to authenticated
using (
  auth.uid() = 'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
)
with check (
  auth.uid() = 'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
);

create policy "Administrador pode excluir produtos"
on public.products
for delete
to authenticated
using (
  auth.uid() = 'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
);

create policy "Administrador pode visualizar pedidos"
on public.orders
for select
to authenticated
using (
  (select auth.uid()) =
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
);

create policy "Administrador pode atualizar pedidos"
on public.orders
for update
to authenticated
using (
  (select auth.uid()) =
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
)
with check (
  (select auth.uid()) =
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
);

create policy "Administrador pode visualizar itens"
on public.order_items
for select
to authenticated
using (
  (select auth.uid()) =
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid
);

grant select on table public.products to anon, authenticated;
grant insert, update, delete on table public.products to authenticated;
grant select, update on table public.orders to authenticated;
grant select on table public.order_items to authenticated;

commit;
