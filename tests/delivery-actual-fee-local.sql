begin;

insert into public.products (
  slug,
  name,
  price,
  image_url,
  stock
)
values (
  'teste-frete-real',
  'Produto de teste de frete real',
  10.00,
  'https://example.invalid/teste.png',
  20
);

do $$
declare
  v_admin_id constant text := 'dcf88d88-cb5e-4378-89e1-ba1020cb20e8';
  v_non_admin_id constant text := '11111111-1111-4111-8111-111111111111';
  v_delivery_pending_id uuid;
  v_delivery_completed_id uuid;
  v_pickup_completed_id uuid;
  v_result jsonb;
  v_before public.orders%rowtype;
  v_after public.orders%rowtype;
begin
  v_result := public.create_order(
    'Teste Frete Pendente',
    'Entrega',
    'Pix',
    'Endereco de teste',
    null,
    '[{"slug":"teste-frete-real","quantity":1}]'::jsonb,
    pg_catalog.gen_random_uuid(),
    null,
    null,
    'centro'
  );
  v_delivery_pending_id := (v_result ->> 'id')::uuid;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin_id, true);

  /* A: entrega nao finalizada aceita 14.50. */
  perform public.set_order_actual_delivery_fee(v_delivery_pending_id, 14.50);
  if (select delivery_actual_fee from public.orders
      where id = v_delivery_pending_id) <> 14.50 then
    raise exception 'A falhou: frete real nao foi salvo no pedido pendente.';
  end if;

  /* I: zero e aceito. */
  perform public.set_order_actual_delivery_fee(v_delivery_pending_id, 0);
  if (select delivery_actual_fee from public.orders
      where id = v_delivery_pending_id) <> 0 then
    raise exception 'I falhou: valor zero nao foi aceito.';
  end if;

  /* H: valor negativo e rejeitado. */
  begin
    perform public.set_order_actual_delivery_fee(v_delivery_pending_id, -0.01);
    raise exception 'H falhou: valor negativo foi aceito.';
  exception
    when sqlstate '22023' then null;
  end;

  /* NULL continua rejeitado. */
  begin
    perform public.set_order_actual_delivery_fee(v_delivery_pending_id, null);
    raise exception 'Valor NULL foi aceito.';
  exception
    when sqlstate '22023' then null;
  end;

  /* G: authenticated nao administrativo e rejeitado. */
  perform pg_catalog.set_config('request.jwt.claim.sub', v_non_admin_id, true);
  begin
    perform public.set_order_actual_delivery_fee(v_delivery_pending_id, 12.00);
    raise exception 'G falhou: usuario nao administrativo foi aceito.';
  exception
    when sqlstate '42501' then null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin_id, true);

  v_result := public.create_order(
    'Teste Frete Concluido',
    'Entrega',
    'Pix',
    'Endereco de teste',
    null,
    '[{"slug":"teste-frete-real","quantity":1}]'::jsonb,
    pg_catalog.gen_random_uuid(),
    null,
    null,
    'centro'
  );
  v_delivery_completed_id := (v_result ->> 'id')::uuid;

  perform public.confirm_order(v_delivery_completed_id);
  if not public.complete_order(v_delivery_completed_id) then
    raise exception 'Nao foi possivel concluir o pedido de Entrega de teste.';
  end if;

  select * into v_before
  from public.orders
  where id = v_delivery_completed_id;

  if v_before.delivery_actual_fee is not null then
    raise exception 'B falhou: frete real inicial nao era NULL.';
  end if;

  /* B: pedido completed aceita a primeira gravacao. */
  perform public.set_order_actual_delivery_fee(v_delivery_completed_id, 14.50);
  if (select delivery_actual_fee from public.orders
      where id = v_delivery_completed_id) <> 14.50 then
    raise exception 'B falhou: frete real nao foi salvo no pedido completed.';
  end if;

  /* C e validacao final: correcao para 13.80 preserva todo o snapshot. */
  perform public.set_order_actual_delivery_fee(v_delivery_completed_id, 13.80);
  select * into v_after
  from public.orders
  where id = v_delivery_completed_id;

  if v_after.delivery_actual_fee <> 13.80 then
    raise exception 'C falhou: frete real nao foi corrigido para 13.80.';
  end if;

  if (pg_catalog.to_jsonb(v_after) - 'delivery_actual_fee')
     is distinct from
     (pg_catalog.to_jsonb(v_before) - 'delivery_actual_fee') then
    raise exception
      'C falhou: a correcao alterou delivery_fee, total ou outro campo.';
  end if;

  /* D: frete real junto com outro campo e rejeitado. */
  begin
    update public.orders
    set delivery_actual_fee = 12.00,
        delivery_fee = 1.00
    where id = v_delivery_completed_id;
    raise exception 'D falhou: alteracao combinada foi aceita.';
  exception
    when sqlstate 'P0001' then null;
  end;

  /* E: campos comerciais e de estado continuam imutaveis. */
  begin
    update public.orders set subtotal = subtotal + 1
    where id = v_delivery_completed_id;
    raise exception 'E falhou: subtotal foi alterado.';
  exception
    when sqlstate 'P0001' then null;
  end;

  begin
    update public.orders set delivery_neighborhood = 'Outro bairro'
    where id = v_delivery_completed_id;
    raise exception 'E falhou: bairro foi alterado.';
  exception
    when sqlstate 'P0001' then null;
  end;

  begin
    update public.orders set customer_name = 'Outro Nome'
    where id = v_delivery_completed_id;
    raise exception 'E falhou: customer_name foi alterado.';
  exception
    when sqlstate 'P0001' then null;
  end;

  begin
    update public.orders set status = 'confirmed'
    where id = v_delivery_completed_id;
    raise exception 'E falhou: status foi alterado.';
  exception
    when sqlstate 'P0001' then null;
  end;

  begin
    update public.orders set updated_at = updated_at + interval '1 second'
    where id = v_delivery_completed_id;
    raise exception 'E falhou: timestamp foi alterado.';
  exception
    when sqlstate 'P0001' then null;
  end;

  /* Coluna generated total tambem nao aceita escrita direta. */
  begin
    update public.orders set total = total + 1
    where id = v_delivery_completed_id;
    raise exception 'E falhou: total foi alterado.';
  exception
    when generated_always then null;
  end;

  v_result := public.create_order(
    'Teste Retirada Concluida',
    'Retirada',
    'Pix',
    null,
    null,
    '[{"slug":"teste-frete-real","quantity":1}]'::jsonb,
    pg_catalog.gen_random_uuid(),
    null,
    null,
    null
  );
  v_pickup_completed_id := (v_result ->> 'id')::uuid;

  perform public.confirm_order(v_pickup_completed_id);
  if not public.complete_order(v_pickup_completed_id) then
    raise exception 'Nao foi possivel concluir a Retirada de teste.';
  end if;

  /* F: Retirada completed continua rejeitada pela RPC. */
  begin
    perform public.set_order_actual_delivery_fee(v_pickup_completed_id, 10.00);
    raise exception 'F falhou: Retirada aceitou frete real.';
  exception
    when sqlstate '22023' then null;
  end;

  raise notice 'Testes transacionais de delivery_actual_fee: A-I aprovados.';
end;
$$;

rollback;
