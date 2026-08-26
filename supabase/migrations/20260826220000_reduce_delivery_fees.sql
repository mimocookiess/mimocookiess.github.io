/*
 * Subsidia as tarifas comerciais de entrega sem alterar pedidos existentes.
 *
 * A reversao deve ser feita por uma nova migration com os 52 valores anteriores
 * explicitos. orders.delivery_fee e delivery_actual_fee nao sao modificados.
 */

do $$
declare
  v_zone_count integer;
  v_updated_count integer;
begin
  select count(*)
  into v_zone_count
  from public.delivery_zones;

  if v_zone_count <> 52 then
    raise exception
      'Esperadas 52 zonas de entrega antes da atualizacao; encontradas %.',
      v_zone_count;
  end if;

  with desired_fees(slug, fee) as (
    values
      ('aeroporto-velho', 6.00::numeric),
      ('aldeia', 8.00::numeric),
      ('alvorada', 16.00::numeric),
      ('amparo', 15.20::numeric),
      ('aparecida', 6.20::numeric),
      ('area-verde', 9.00::numeric),
      ('cambuquira', 16.00::numeric),
      ('caranazal', 8.00::numeric),
      ('centro', 7.00::numeric),
      ('cidade-jardim', 13.40::numeric),
      ('conquista', 15.20::numeric),
      ('diamantino', 7.00::numeric),
      ('elcione-barbalho', 15.00::numeric),
      ('esperanca', 6.00::numeric),
      ('espirito-santo', 11.60::numeric),
      ('fatima', 7.00::numeric),
      ('floresta', 8.00::numeric),
      ('interventoria', 6.00::numeric),
      ('ipanema', 15.20::numeric),
      ('jaderlandia', 13.40::numeric),
      ('jardim-santarem', 6.00::numeric),
      ('jua', 11.60::numeric),
      ('jutai', 15.20::numeric),
      ('laguinho', 8.00::numeric),
      ('liberdade', 6.20::numeric),
      ('livramento', 16.00::numeric),
      ('maica', 15.20::numeric),
      ('mapiri', 11.00::numeric),
      ('maracana', 16.00::numeric),
      ('maracana-i', 16.00::numeric),
      ('mararu', 16.00::numeric),
      ('matinha', 15.20::numeric),
      ('nova-jerusalem', 13.40::numeric),
      ('nova-republica', 11.60::numeric),
      ('nova-vitoria', 16.00::numeric),
      ('novo-horizonte', 16.00::numeric),
      ('perola-do-maica', 16.00::numeric),
      ('prainha', 6.00::numeric),
      ('sale', 8.00::numeric),
      ('santa-clara', 7.00::numeric),
      ('santana', 8.00::numeric),
      ('santarenzinho', 13.40::numeric),
      ('santissimo', 6.00::numeric),
      ('santo-andre', 13.40::numeric),
      ('sao-cristovao', 16.00::numeric),
      ('sao-francisco', 13.40::numeric),
      ('sao-jose-operario', 11.60::numeric),
      ('uruara', 7.00::numeric),
      ('urumanduba', 16.00::numeric),
      ('urumari', 8.00::numeric),
      ('vigia', 16.00::numeric),
      ('vitoria-regia', 16.00::numeric)
  ),
  validated_fees as (
    select desired_fees.slug, desired_fees.fee
    from desired_fees
    where (
      select count(*) = 52
        and count(distinct desired_fees.slug) = 52
      from desired_fees
    )
  ),
  updated_zones as (
    update public.delivery_zones as delivery_zones
    set fee = validated_fees.fee
    from validated_fees
    where delivery_zones.slug = validated_fees.slug
    returning delivery_zones.slug
  )
  select count(*)
  into v_updated_count
  from updated_zones;

  if v_updated_count <> 52 then
    raise exception
      'Esperadas 52 zonas atualizadas; atualizadas %.',
      v_updated_count;
  end if;
end;
$$;
