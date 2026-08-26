# Site Mimo Cookies

Site estático, responsivo e pronto para GitHub Pages.

## Antes de publicar

Abra `config.js` e preencha o número do WhatsApp e a site key pública do Cloudflare Turnstile:

```js
whatsappNumber: "5593984120133",
turnstileSiteKey: "SUA_SITE_KEY_PUBLICA"
```

Use apenas números, incluindo:
- 55 (Brasil)
- DDD
- número com 9 dígitos

O secret do Turnstile nunca deve ser colocado no frontend ou neste repositório.

## Alterar preços, sabores ou disponibilidade

Use o painel administrativo. O arquivo `products.js` contém somente o cardápio de contingência usado quando os produtos não podem ser carregados do Supabase.

Para esgotar um sabor:

```js
available: false
```

## Proteção contra bots

Novos pedidos seguem este fluxo:

1. o frontend obtém um token do Cloudflare Turnstile;
2. o frontend envia o token e o pedido para a Edge Function `create-order`;
3. a Edge Function valida o token no Siteverify, incluindo `success`, hostname e action `create_order`;
4. somente após a validação, a Edge Function chama `public.create_order` com a credencial server-side;
5. o frontend recebe o número do pedido e abre o WhatsApp normalmente.

O frontend não chama mais `public.create_order` diretamente.

### Variáveis da Edge Function

Configure em **Supabase > Edge Functions > Secrets**:

```text
TURNSTILE_SECRET_KEY=<secret fornecido pela Cloudflare>
TURNSTILE_ALLOWED_HOSTNAMES=lojamimocookies.com.br,www.lojamimocookies.com.br
ALLOWED_ORIGINS=https://lojamimocookies.com.br,https://www.lojamimocookies.com.br
```

Não é necessário cadastrar manualmente `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY`: o ambiente hospedado das Edge Functions fornece essas variáveis. Elas nunca devem ser copiadas para o frontend.

### Desenvolvimento local

1. Copie `supabase/functions/.env.example` para `supabase/functions/.env.local`.
2. Use apenas as chaves oficiais de teste do Turnstile.
3. Ajuste as origens e hostnames locais no arquivo não versionado.
4. Sirva a função:

```bash
supabase functions serve create-order \
  --env-file supabase/functions/.env.local \
  --no-verify-jwt
```

5. Use uma site key de teste em `config.js` somente durante o teste local.

O repositório ainda não contém o schema completo do banco. Para um teste integrado totalmente local, será necessário disponibilizar migrations do schema e das funções sem dados de produção.

### Implantação segura

1. Configure o widget e os secrets.
2. Conceda antecipadamente apenas `EXECUTE` a `service_role`, usando o `GRANT` presente na migration. Não faça os `REVOKE` ainda.
3. Faça deploy da Edge Function.
4. Teste a Edge Function enquanto a RPC ainda aceita o frontend atual.
5. Publique o frontend com a site key.
6. Confirme que um pedido passa pela Edge Function.
7. Aplique `supabase/migrations/20260802000000_restrict_create_order_execution.sql`; o `GRANT` será repetido sem efeito colateral e os acessos diretos serão revogados.
8. Verifique que `anon` e `authenticated` não conseguem mais chamar `create_order`, mas a Edge Function continua funcionando.

A migration completa não deve ser aplicada antes do deploy do frontend novo, pois isso interromperia pedidos de páginas antigas em cache. O grant preparatório é necessário porque a auditoria atual mostra `service_role` sem permissão para executar `create_order`.

## Publicar no GitHub Pages

1. Crie uma conta no GitHub.
2. Crie um repositório público, por exemplo `mimo-cookies`.
3. Envie todos os arquivos desta pasta para a raiz do repositório.
4. Vá em **Settings > Pages**.
5. Em **Build and deployment**, escolha **Deploy from a branch**.
6. Selecione a branch `main` e a pasta `/ (root)`.
7. Salve. Em alguns minutos o site ficará disponível.

## Domínio próprio

Depois, no GitHub:
1. Vá em **Settings > Pages**.
2. Preencha **Custom domain** com o domínio escolhido.
3. No Registro.br, configure os registros DNS indicados pelo GitHub.

## Frete

A versão atual oferece:
- retirada grátis;
- entrega com tarifa fixa calculada automaticamente pelo bairro;
- bairro escolhido em autocomplete acessível no checkout;
- tarifa validada pelo Supabase e salva como snapshot no pedido;
- registro administrativo posterior do frete real pago ao entregador.

As tarifas ativas são expostas somente pela RPC de leitura
`public.list_delivery_zones()`. O frontend envia o slug selecionado, e
`public.create_order` consulta a tarifa vigente antes de criar o pedido.

## Regra futura de relatórios

Quando os relatórios forem implementados, pedidos com status `completed` devem contar como vendas concluídas. Pedidos `confirmed` representam pedidos aceitos, mas ainda não necessariamente concluídos, e pedidos `cancelled` não devem contar como vendas.


## Informações da loja

- 1ª cookieteria de Santarém
- Cookies artesanais assados na hora
- Funcionamento: 10h às 21h
