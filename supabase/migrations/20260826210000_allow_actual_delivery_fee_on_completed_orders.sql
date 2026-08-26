begin;

/*
 * O trigger generico de updated_at rodava antes da validacao de pedidos
 * concluidos. Alem de fazer qualquer UPDATE parecer uma mudanca adicional, ele
 * impedia que somente delivery_actual_fee fosse corrigido sem alterar timestamp.
 * A validacao abaixo passa a cuidar do updated_at dos pedidos ainda mutaveis e
 * mantem pedidos completed integralmente imutaveis, exceto pelo custo interno.
 *
 * Rollback conceitual: restaurar a versao anterior da funcao e recriar o trigger
 * set_orders_updated_at apontando para public.set_updated_at().
 */
drop trigger if exists set_orders_updated_at
on public.orders;

create or replace function public.validate_completed_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'completed' then
    if new is not distinct from old then
      return old;
    end if;

    if new.delivery_actual_fee is distinct from old.delivery_actual_fee
       and (
         pg_catalog.to_jsonb(new) - 'delivery_actual_fee' - 'total'
       ) is not distinct from (
         pg_catalog.to_jsonb(old) - 'delivery_actual_fee' - 'total'
       ) then
      return new;
    end if;

    raise exception 'Pedidos finalizados nao podem ser alterados.'
      using errcode = 'P0001';
  end if;

  if new.status = 'completed' and old.status <> 'confirmed' then
    raise exception 'Somente pedidos confirmados podem ser finalizados.'
      using errcode = 'P0001';
  end if;

  if new.status = 'completed' and old.status is distinct from new.status then
    new.completed_at := pg_catalog.now();
  end if;

  new.updated_at := pg_catalog.now();

  return new;
end;
$$;

commit;
