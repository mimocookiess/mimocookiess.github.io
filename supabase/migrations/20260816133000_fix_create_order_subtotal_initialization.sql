begin;

create or replace function public.create_order(
  p_customer_name text,
  p_delivery_method text,
  p_payment_method text,
  p_customer_address text,
  p_notes text,
  p_items jsonb,
  p_checkout_attempt_id uuid,
  p_ga_client_id text,
  p_ga_session_id text
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
  v_payment_method text;
  v_payment_status text;

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
  p_ga_client_id := nullif(trim(p_ga_client_id), '');
  p_ga_session_id := nullif(trim(p_ga_session_id), '');

  if p_checkout_attempt_id is null then
    raise exception 'Identificador de tentativa invalido.';
  end if;

  if p_ga_client_id is not null
     and p_ga_client_id !~ '^[A-Za-z0-9._-]{1,128}$' then
    raise exception 'Identificador analitico invalido.';
  end if;

  if p_ga_session_id is not null
     and p_ga_session_id !~ '^[0-9]{1,32}$' then
    raise exception 'Identificador de sessao invalido.';
  end if;

  if p_customer_name is null
     or p_customer_name = ''
     or char_length(p_customer_name) < 2
     or char_length(p_customer_name) > 100 then
    raise exception 'Nome inválido.';
  end if;

  if p_delivery_method is null
     or p_delivery_method = ''
     or p_delivery_method not in ('Retirada', 'Entrega') then
    raise exception 'Forma de recebimento inválida.';
  end if;

  if p_payment_method is null
     or p_payment_method = ''
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

  if p_notes is not null
     and char_length(p_notes) > 500 then
    raise exception 'As observações devem ter no máximo 500 caracteres.';
  end if;

  if p_items is null then
    raise exception 'O pedido precisa ter pelo menos um produto.';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Os itens do pedido devem ser enviados como uma lista.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'O pedido precisa ter pelo menos um produto.';
  end if;

  if jsonb_array_length(p_items) > 20 then
    raise exception 'O pedido possui produtos demais.';
  end if;

  /*
   * Um retry concluido deve recuperar o snapshot original sem revalidar
   * disponibilidade ou estoque, que podem ter mudado desde a criacao.
   */
  select
    id,
    order_number,
    subtotal,
    payment_method,
    payment_status
  into
    v_order_id,
    v_order_number,
    v_subtotal,
    v_payment_method,
    v_payment_status
  from public.orders
  where checkout_attempt_id = p_checkout_attempt_id;

  if found then
    return jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order_number,
      'subtotal', v_subtotal,
      'payment_method', v_payment_method,
      'payment_status', v_payment_status
    );
  end if;

  v_subtotal := 0;

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

    v_normalized_items :=
      v_normalized_items ||
      jsonb_build_array(
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

    v_validated_items :=
      v_validated_items ||
      jsonb_build_array(
        jsonb_build_object(
          'product_id', v_product.id,
          'slug', v_product.slug,
          'name', v_product.name,
          'price', v_product.price,
          'total_quantity', v_grouped_item.total_quantity
        )
      );
  end loop;

  /*
   * A constraint UNIQUE arbitra requisicoes simultaneas. ON CONFLICT espera
   * a transacao concorrente e somente uma chamada recebe a linha inserida.
   */
  insert into public.orders (
    customer_name,
    delivery_method,
    payment_method,
    payment_status,
    customer_address,
    notes,
    subtotal,
    checkout_attempt_id,
    ga_client_id,
    ga_session_id
  )
  values (
    p_customer_name,
    p_delivery_method,
    p_payment_method,
    'pending',
    p_customer_address,
    p_notes,
    v_subtotal,
    p_checkout_attempt_id,
    p_ga_client_id,
    p_ga_session_id
  )
  on conflict (checkout_attempt_id) do nothing
  returning id, order_number
  into v_order_id, v_order_number;

  if not found then
    select
      id,
      order_number,
      subtotal,
      payment_method,
      payment_status
    into
      v_order_id,
      v_order_number,
      v_subtotal,
      v_payment_method,
      v_payment_status
    from public.orders
    where checkout_attempt_id = p_checkout_attempt_id;

    if not found then
      raise exception 'Não foi possível recuperar o pedido existente.';
    end if;

    return jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order_number,
      'subtotal', v_subtotal,
      'payment_method', v_payment_method,
      'payment_status', v_payment_status
    );
  end if;

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

commit;

