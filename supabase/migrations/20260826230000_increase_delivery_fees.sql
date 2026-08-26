/*
 * Aumenta em R$ 1,00 as tarifas comerciais vigentes por meio de valores finais
 * explicitos. Pedidos existentes e seus snapshots nao sao modificados.
 *
 * A reversao deve ser feita por uma nova migration com os 52 valores anteriores.
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
      ('aeroporto-velho', 7.00::numeric),
      ('aldeia', 9.00::numeric),
      ('alvorada', 17.00::numeric),
      ('amparo', 16.20::numeric),
      ('aparecida', 7.20::numeric),
      ('area-verde', 10.00::numeric),
      ('cambuquira', 17.00::numeric),
      ('caranazal', 9.00::numeric),
      ('centro', 8.00::numeric),
      ('cidade-jardim', 14.40::numeric),
      ('conquista', 16.20::numeric),
      ('diamantino', 8.00::numeric),
      ('elcione-barbalho', 16.00::numeric),
      ('esperanca', 7.00::numeric),
      ('espirito-santo', 12.60::numeric),
      ('fatima', 8.00::numeric),
      ('floresta', 9.00::numeric),
      ('interventoria', 7.00::numeric),
      ('ipanema', 16.20::numeric),
      ('jaderlandia', 14.40::numeric),
      ('jardim-santarem', 7.00::numeric),
      ('jua', 12.60::numeric),
      ('jutai', 16.20::numeric),
      ('laguinho', 9.00::numeric),
      ('liberdade', 7.20::numeric),
      ('livramento', 17.00::numeric),
      ('maica', 16.20::numeric),
      ('mapiri', 12.00::numeric),
      ('maracana', 17.00::numeric),
      ('maracana-i', 17.00::numeric),
      ('mararu', 17.00::numeric),
      ('matinha', 16.20::numeric),
      ('nova-jerusalem', 14.40::numeric),
      ('nova-republica', 12.60::numeric),
      ('nova-vitoria', 17.00::numeric),
      ('novo-horizonte', 17.00::numeric),
      ('perola-do-maica', 17.00::numeric),
      ('prainha', 7.00::numeric),
      ('sale', 9.00::numeric),
      ('santa-clara', 8.00::numeric),
      ('santana', 9.00::numeric),
      ('santarenzinho', 14.40::numeric),
      ('santissimo', 7.00::numeric),
      ('santo-andre', 14.40::numeric),
      ('sao-cristovao', 17.00::numeric),
      ('sao-francisco', 14.40::numeric),
      ('sao-jose-operario', 12.60::numeric),
      ('uruara', 8.00::numeric),
      ('urumanduba', 17.00::numeric),
      ('urumari', 9.00::numeric),
      ('vigia', 17.00::numeric),
      ('vitoria-regia', 17.00::numeric)
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
