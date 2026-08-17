begin;

/*
 * Rollback conceitual:
 * 1. interromper o worker;
 * 2. preservar/exportar a outbox para recuperacao;
 * 3. restaurar complete_order pela migration anterior;
 * 4. somente com autorizacao explicita, remover funcoes e tabela novas.
 *
 * Nao ha backfill: pedidos ja completed nao entram na outbox.
 */
create table public.ga4_purchase_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null
    constraint ga4_purchase_outbox_order_id_fkey
    references public.orders(id)
    on delete restrict,
  status text not null default 'pending'
    constraint ga4_purchase_outbox_status_check
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0
    constraint ga4_purchase_outbox_attempt_count_check
    check (attempt_count >= 0 and attempt_count <= 5),
  claim_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz default now(),
  last_error text
    constraint ga4_purchase_outbox_last_error_check
    check (
      last_error is null
      or (
        char_length(last_error) between 1 and 120
        and last_error ~ '^[a-z0-9_]+$'
      )
    ),
  constraint ga4_purchase_outbox_order_id_key unique (order_id),
  constraint ga4_purchase_outbox_state_check check (
    (
      status = 'pending'
      and claim_token is null
      and sent_at is null
      and next_attempt_at is not null
    )
    or (
      status = 'sending'
      and claim_token is not null
      and last_attempt_at is not null
      and sent_at is null
      and next_attempt_at is null
    )
    or (
      status = 'sent'
      and claim_token is null
      and sent_at is not null
      and next_attempt_at is null
    )
    or (
      status = 'failed'
      and claim_token is null
      and sent_at is null
    )
  )
);

comment on table public.ga4_purchase_outbox is
  'Fila sem PII para envio idempotente de purchase ao GA4.';

create index ga4_purchase_outbox_claim_idx
on public.ga4_purchase_outbox (
  status,
  next_attempt_at,
  last_attempt_at,
  created_at
)
where status in ('pending', 'sending', 'failed');

create trigger set_ga4_purchase_outbox_updated_at
before update on public.ga4_purchase_outbox
for each row
execute function public.set_updated_at();

alter table public.ga4_purchase_outbox enable row level security;

revoke all on table public.ga4_purchase_outbox
from public, anon, authenticated;

create or replace function public.validate_completed_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'completed' and new is distinct from old then
    raise exception 'Pedidos finalizados não podem ser alterados.'
      using errcode = 'P0001';
  end if;

  if new.status = 'completed' and old.status <> 'confirmed' then
    raise exception 'Somente pedidos confirmados podem ser finalizados.'
      using errcode = 'P0001';
  end if;

  if new.status = 'completed' and old.status is distinct from new.status then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

create function public.enqueue_ga4_purchase_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ga4_purchase_outbox (order_id)
  values (new.id)
  on conflict (order_id) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_ga4_purchase_on_completion()
from public, anon, authenticated;

create trigger enqueue_ga4_purchase_on_completion
after update of status on public.orders
for each row
when (
  old.status is distinct from new.status
  and new.status = 'completed'
)
execute function public.enqueue_ga4_purchase_on_completion();

create function public.claim_ga4_purchase_outbox(
  p_limit integer default 5
)
returns table (
  outbox_id uuid,
  purchase_order_id uuid,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Acesso não autorizado.'
      using errcode = '42501';
  end if;

  /*
   * Uma quinta tentativa que perdeu o lease nao pode ficar eternamente em
   * sending nem ser reclamada sem limite.
   */
  update public.ga4_purchase_outbox as queue
  set
    status = 'failed',
    claim_token = null,
    next_attempt_at = null,
    last_error = 'worker_lease_expired'
  where queue.status = 'sending'
    and queue.attempt_count >= 5
    and queue.last_attempt_at < now() - interval '15 minutes';

  return query
  with candidates as (
    select queue.id
    from public.ga4_purchase_outbox as queue
    where queue.attempt_count < 5
      and (
        (
          queue.status in ('pending', 'failed')
          and queue.next_attempt_at is not null
          and queue.next_attempt_at <= now()
        )
        or (
          queue.status = 'sending'
          and queue.last_attempt_at < now() - interval '15 minutes'
        )
      )
    order by
      coalesce(queue.next_attempt_at, queue.last_attempt_at),
      queue.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ),
  claimed as (
    update public.ga4_purchase_outbox as queue
    set
      status = 'sending',
      attempt_count = queue.attempt_count + 1,
      claim_token = gen_random_uuid(),
      last_attempt_at = now(),
      next_attempt_at = null,
      last_error = null
    from candidates
    where queue.id = candidates.id
    returning queue.id, queue.order_id, queue.claim_token
  )
  select
    claimed.id,
    claimed.order_id,
    claimed.claim_token
  from claimed;
end;
$$;

create function public.mark_ga4_purchase_sent(
  p_outbox_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Acesso não autorizado.'
      using errcode = '42501';
  end if;

  update public.ga4_purchase_outbox
  set
    status = 'sent',
    claim_token = null,
    sent_at = now(),
    next_attempt_at = null,
    last_error = null
  where id = p_outbox_id
    and status = 'sending'
    and claim_token = p_claim_token;

  get diagnostics updated_count = row_count;

  return updated_count = 1;
end;
$$;

create function public.mark_ga4_purchase_failed(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_retryable boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_error text;
  updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Acesso não autorizado.'
      using errcode = '42501';
  end if;

  normalized_error := lower(trim(coalesce(p_error_code, 'worker_error')));

  if normalized_error !~ '^[a-z0-9_]{1,120}$' then
    normalized_error := 'worker_error';
  end if;

  update public.ga4_purchase_outbox
  set
    status = 'failed',
    claim_token = null,
    sent_at = null,
    next_attempt_at = case
      when p_retryable and attempt_count < 5 then
        now() + make_interval(
          secs => least(3600, 60 * power(2, attempt_count - 1)::integer)
        )
      else null
    end,
    last_error = normalized_error
  where id = p_outbox_id
    and status = 'sending'
    and claim_token = p_claim_token;

  get diagnostics updated_count = row_count;

  return updated_count = 1;
end;
$$;

create function public.retry_ga4_purchase_outbox(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Acesso não autorizado.'
      using errcode = '42501';
  end if;

  update public.ga4_purchase_outbox as queue
  set
    status = 'pending',
    attempt_count = 0,
    claim_token = null,
    sent_at = null,
    last_attempt_at = null,
    next_attempt_at = now(),
    last_error = null
  from public.orders as orders
  where queue.order_id = p_order_id
    and orders.id = queue.order_id
    and orders.status = 'completed'
    and queue.status = 'failed';

  get diagnostics updated_count = row_count;

  return updated_count = 1;
end;
$$;

revoke all on function public.claim_ga4_purchase_outbox(integer)
from public, anon, authenticated;

revoke all on function public.mark_ga4_purchase_sent(uuid, uuid)
from public, anon, authenticated;

revoke all on function public.mark_ga4_purchase_failed(
  uuid,
  uuid,
  text,
  boolean
)
from public, anon, authenticated;

revoke all on function public.retry_ga4_purchase_outbox(uuid)
from public, anon, authenticated;

grant execute on function public.claim_ga4_purchase_outbox(integer)
to service_role;

grant execute on function public.mark_ga4_purchase_sent(uuid, uuid)
to service_role;

grant execute on function public.mark_ga4_purchase_failed(
  uuid,
  uuid,
  text,
  boolean
)
to service_role;

grant execute on function public.retry_ga4_purchase_outbox(uuid)
to service_role;

commit;
