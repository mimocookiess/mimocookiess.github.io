begin;

create extension if not exists pg_net;

create or replace function public.notify_mimo_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  webhook_secret text;
begin
  select decrypted_secret
  into project_url
  from vault.decrypted_secrets
  where name = 'mimo_project_url';

  select decrypted_secret
  into webhook_secret
  from vault.decrypted_secrets
  where name = 'mimo_database_webhook_secret';

  if project_url is null or webhook_secret is null then
    raise warning 'New-order notification skipped: required Vault secrets are missing.';
    return new;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/notify-new-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Mimo-Webhook-Secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(new),
      'old_record', null
    ),
    timeout_milliseconds := 10000
  );

  return new;
exception
  when others then
    raise warning 'New-order notification could not be queued.';
    return new;
end;
$$;

drop trigger if exists notify_mimo_new_order_after_insert
on public.orders;

create trigger notify_mimo_new_order_after_insert
after insert on public.orders
for each row
execute function public.notify_mimo_new_order();

commit;
