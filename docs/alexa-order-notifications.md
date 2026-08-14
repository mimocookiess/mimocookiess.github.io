# Notificações de novos pedidos na Alexa

## Arquitetura

```text
checkout
  ↓
create-order
  ↓
INSERT public.orders
  ↓
trigger PostgreSQL
  ↓
pg_net
  ↓
notify-new-order Edge Function
  ↓
Home Assistant webhook
  ↓
Alexa Announce
```

O trigger é executado somente após um `INSERT` em `public.orders`. Ele usa o
`pg_net` para chamar a Edge Function de modo assíncrono. Falhas na notificação
geram apenas um aviso sanitizado no PostgreSQL e não impedem a criação do
pedido.

## Componentes versionados

- `supabase/migrations/20260814000000_add_new_order_notification_infrastructure.sql`:
  extensão, trigger e função PostgreSQL que inicia a notificação;
- `supabase/functions/notify-new-order/index.ts`: valida a chamada do banco e
  envia ao Home Assistant apenas o número e o total do pedido;
- `supabase/config.toml`: configuração da Edge Function.

## Componentes não versionados

- secrets da Edge Function `HOME_ASSISTANT_NEW_ORDER_WEBHOOK_URL` e
  `MIMO_DATABASE_WEBHOOK_SECRET`;
- valores dos secrets `mimo_project_url` e
  `mimo_database_webhook_secret` no Supabase Vault;
- ID do webhook e demais configurações do Home Assistant;
- configuração da VM;
- token do Cloudflare;
- autenticação e configuração da Alexa.

Não versione arquivos `.storage` do Home Assistant nem copie configurações
sensíveis da VM para este repositório.

## Reconstrução

Use valores novos e seguros nos lugares indicados por placeholders. Nunca
registre os valores reais no Git, em comandos compartilhados ou em logs.

1. Aplique as migrations do projeto no ambiente que será reconstruído.
2. Crie no Supabase Vault o secret `mimo_project_url` com
   `<URL_DO_PROJETO_SUPABASE>`.
3. Crie no Supabase Vault o secret `mimo_database_webhook_secret` com
   `<SEGREDO_COMPARTILHADO_FORTE>`.
4. Crie o secret da Edge Function `HOME_ASSISTANT_NEW_ORDER_WEBHOOK_URL` com
   `<URL_HTTPS_COMPLETA_DO_WEBHOOK_DO_HOME_ASSISTANT>`.
5. Crie o secret da Edge Function `MIMO_DATABASE_WEBHOOK_SECRET` com o mesmo
   `<SEGREDO_COMPARTILHADO_FORTE>` usado no Vault.
6. Faça o deploy da Edge Function `notify-new-order`.
7. Configure o webhook/automação no Home Assistant e a ação Alexa Announce.
8. Faça um teste controlado do webhook com dados fictícios.
9. Faça um pedido real de teste e confirme o fluxo completo sem expor dados
   sensíveis nos logs.

O Home Assistant deve ter um webhook/automação capaz de receber um JSON neste
formato e executar a entidade Announce da Echo:

```json
{
  "order_number": 999,
  "total": 46.50
}
```

O ID real do webhook deve permanecer apenas na configuração segura do Home
Assistant e no secret que contém sua URL.
