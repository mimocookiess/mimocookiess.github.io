begin;

/*
 * Pedidos concluidos sao imutaveis, e toda atualizacao normalmente altera
 * updated_at. Desabilita ambos os triggers somente durante o backfill para
 * preservar o horario historico usado como completed_at.
 */
alter table public.orders
disable trigger validate_completed_order_transition;

alter table public.orders
disable trigger set_orders_updated_at;

update public.orders
set completed_at = updated_at
where status = 'completed'
  and completed_at is null;

alter table public.orders
enable trigger set_orders_updated_at;

alter table public.orders
enable trigger validate_completed_order_transition;

create or replace function public.complete_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_order_count integer;
begin
  if auth.uid() is distinct from
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid then
    raise exception 'Acesso não autorizado.'
      using errcode = '42501';
  end if;

  update public.orders
  set
    status = 'completed',
    completed_at = now()
  where id = p_order_id
    and status = 'confirmed';

  get diagnostics updated_order_count = row_count;

  return updated_order_count = 1;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.orders
    where status = 'completed'
      and completed_at is null
  ) then
    raise exception
      'Existem pedidos concluidos sem data de conclusao apos o backfill.';
  end if;
end;
$$;

commit;
