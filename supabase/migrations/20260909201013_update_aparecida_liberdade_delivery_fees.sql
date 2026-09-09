-- Altera somente as tarifas comerciais de Aparecida e Liberdade.
-- Snapshots de pedidos existentes permanecem preservados.
-- Reversao: nova migration para estes dois slugs, com os valores anteriores
-- de 7.20, mediante nova auditoria e autorizacao para producao.
begin;

do $$
declare
  v_updated_count integer;
  v_total_updated integer := 0;
begin
  lock table public.delivery_zones in share row exclusive mode;

  if (select count(*) from public.delivery_zones) <> 52
    or (select count(distinct slug) from public.delivery_zones) <> 52 then
    raise exception 'Esperadas 52 zonas com slugs unicos.';
  end if;

  if (select count(*) from public.delivery_zones
      where slug in ('aparecida', 'liberdade') and active = true and fee = 7.20) <> 2 then
    raise exception 'Esperadas Aparecida e Liberdade ativas com tarifa 7.20.';
  end if;

  update public.delivery_zones set fee = 9.00 where slug = 'aparecida';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Esperada exatamente uma zona Aparecida.';
  end if;
  v_total_updated := v_total_updated + v_updated_count;

  update public.delivery_zones set fee = 9.00 where slug = 'liberdade';
  get diagnostics v_updated_count = row_count;
  v_total_updated := v_total_updated + v_updated_count;
  if v_updated_count <> 1 or v_total_updated <> 2 then
    raise exception 'Esperadas exatamente duas zonas atualizadas.';
  end if;

  if (select count(*) from public.delivery_zones
      where slug in ('aparecida', 'liberdade') and fee = 9.00 and active = true) <> 2 then
    raise exception 'Falha na validacao das tarifas finais.';
  end if;
end;
$$;

commit;
