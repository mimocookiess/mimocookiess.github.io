begin;

alter table public.orders
add column cancellation_reason text
constraint orders_cancellation_reason_check
check (
  cancellation_reason is null
  or cancellation_reason in (
    'test_order',
    'duplicate_order',
    'whatsapp_not_confirmed',
    'other'
  )
);

create function public.cancel_order_with_reason(
  p_order_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_status text;
  cancelled_status text;
begin
  if auth.uid() is distinct from
    'dcf88d88-cb5e-4378-89e1-ba1020cb20e8'::uuid then
    raise exception 'Acesso não autorizado.'
      using errcode = '42501';
  end if;

  if p_reason is null or p_reason not in (
    'test_order',
    'duplicate_order',
    'whatsapp_not_confirmed',
    'other'
  ) then
    raise exception 'Motivo de cancelamento inválido.'
      using errcode = '22023';
  end if;

  select status
  into original_status
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado.'
      using errcode = 'P0002';
  end if;

  if original_status = 'cancelled' then
    raise exception 'O pedido já está cancelado.'
      using errcode = 'P0001';
  end if;

  perform public.cancel_order(p_order_id);

  select status
  into cancelled_status
  from public.orders
  where id = p_order_id;

  if cancelled_status is distinct from 'cancelled' then
    raise exception 'Não foi possível cancelar o pedido.'
      using errcode = 'P0001';
  end if;

  update public.orders
  set cancellation_reason = p_reason
  where id = p_order_id
    and status = 'cancelled';

  if not found then
    raise exception 'Não foi possível registrar o motivo do cancelamento.'
      using errcode = 'P0001';
  end if;

  return true;
end;
$$;

revoke all on function public.cancel_order_with_reason(uuid, text)
from public, anon;

grant execute on function public.cancel_order_with_reason(uuid, text)
to authenticated;

commit;
