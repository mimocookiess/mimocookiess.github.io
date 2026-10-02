begin;

-- Data limite da abertura excepcional. Nulo mantém o expediente automático.
alter table public.store_settings
add column manual_open_until timestamptz;

grant update (manual_open_until)
  on table public.store_settings to authenticated;

-- Validação somente leitura ainda dentro da transação.
do $$
declare
  v_data_type text;
  v_is_nullable text;
begin
  select data_type, is_nullable
    into v_data_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'store_settings'
    and column_name = 'manual_open_until';

  if v_data_type is distinct from 'timestamp with time zone'
     or v_is_nullable is distinct from 'YES' then
    raise exception 'manual_open_until precisa ser timestamptz nullable';
  end if;

  if not has_column_privilege(
    'authenticated',
    'public.store_settings',
    'manual_open_until',
    'UPDATE'
  ) then
    raise exception 'authenticated precisa de UPDATE em manual_open_until';
  end if;
end;
$$;

commit;
