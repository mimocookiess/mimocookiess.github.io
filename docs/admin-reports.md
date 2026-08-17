# Relatórios administrativos

## Fonte e período

A primeira versão usa somente `orders` e `order_items` no Supabase. O filtro é
aplicado à data de criação do pedido (`orders.created_at`), pois representa o
momento da demanda. A data final é inclusiva.

O banco armazena timestamps como `timestamptz`. A RPC recebe datas de calendário
e converte o início e o fim exclusivo do intervalo com
`America/Santarem`. Dia, dia da semana e hora também são calculados nesse fuso.

## Definições

- **Faturamento:** soma de `orders.total` para `status = 'completed'`.
- **Receita de produtos:** soma de `orders.subtotal` nos concluídos.
- **Taxas de entrega:** soma de `coalesce(orders.delivery_fee, 0)` nos
  concluídos. Uma taxa nula é tratada como zero, de acordo com a coluna gerada
  `total`.
- **Pedidos:** quantidade de pedidos concluídos.
- **Ticket médio:** faturamento dividido por pedidos concluídos.
- **Cookies vendidos:** soma de `order_items.quantity` em pedidos concluídos.
- **Cookies por pedido:** cookies vendidos divididos por pedidos concluídos.
- **Valor médio por cookie:** receita de produtos dividida por cookies vendidos.
- **Cancelamentos:** quantidade com `status = 'cancelled'`.
- **Taxa de cancelamento:** cancelados divididos por concluídos mais cancelados;
  pedidos em andamento não entram no denominador.
- **Produto e receita por produto:** agregam pela identidade histórica estável
  `order_items.product_slug`. Unidades e receita usam exclusivamente
  `unit_price` e `quantity` congelados no item; `products.name` fornece somente
  o nome canônico atual exibido na tabela.
- **Participações:** unidades ou receita do produto divididas pelo total de
  unidades ou receita dos produtos no período.
- **Dia, hora e dia da semana:** usam `orders.created_at` convertido para o
  horário local da loja.
- **Entrega e retirada:** agrupamento de pedidos concluídos por
  `orders.delivery_method`, com pedidos, participação, receita e ticket médio.

Divisões sem denominador retornam zero; a interface nunca deve exibir `NaN` ou
`Infinity`.

## Camada SQL e segurança

A migration `20260817193000_create_admin_reports_rpc.sql` cria apenas a função
`public.get_admin_reports(date, date)`. Não há view ou materialized view.
A migration corretiva
`20260817204000_consolidate_admin_report_products.sql` preserva a assinatura e
as permissões da RPC, consolida renomeações pelo `product_slug` e explicita as
referências aos built-ins qualificáveis de `pg_catalog`.

A função é `security definer`, fixa `search_path = ''`, valida internamente o
mesmo UUID administrativo das policies atuais e retorna somente agregados sem
PII. `PUBLIC`, `anon` e `service_role` não recebem `EXECUTE`; somente
`authenticated` recebe o grant, e outra conta autenticada falha na validação de
UUID. As policies existentes de pedidos, itens e produtos não são alteradas.

O índice existente `orders_status_created_at_idx (status, created_at desc)` e o
índice `order_items_order_id_idx` atendem os filtros e joins iniciais. Nenhum
índice novo foi criado para o volume atual.

## Interface

A aba `Relatórios`, seu `reports-panel`, a navegação, a sessão administrativa e
os tokens visuais existentes foram preservados. A interface inclui períodos
rápidos e personalizado, KPIs, métricas secundárias, evolução diária, ranking e
participação dos produtos, distribuição semanal e horária, modalidade de
atendimento e cancelamentos. Gráficos são SVG/HTML/CSS locais, sem framework ou
biblioteca externa.

Há estados explícitos de carregamento, erro, período sem pedidos e período sem
vendas concluídas, além de layouts adaptativos para desktop, tablet e celular.

## Limitações e evolução

- Não há comparação com o período anterior nesta versão. A RPC centralizada
  permite consultar o intervalo anterior sem mudar as definições.
- Não existe histórico de disponibilidade/estoque. Ruptura e possível perda de
  vendas só serão confiáveis após registrar eventos de disponibilidade.
- `delivery_fee` historicamente nulo equivale a zero no `total`; não é possível
  inferir uma taxa que não foi registrada.
- Renomear um produto pode mudar apenas o rótulo canônico exibido em relatórios
  futuros; quantidades, pedidos, preços e receita continuam derivados dos
  snapshots históricos imutáveis de `order_items`.
- Não são calculadas métricas de tráfego, sessões, aquisição, conversão,
  abandono, alcance ou engajamento. Elas dependem de GA4 e Instagram/Meta.
- `ga_client_id` e `ga_session_id` existem em `orders`, mas não são lidos,
  retornados nem alterados pelos relatórios.

Uma evolução futura pode organizar subseções de negócio (Visão geral, Vendas,
Produtos, Site, Aquisição e Instagram) mantendo Supabase, GA4 e Meta como fontes
técnicas complementares por trás da mesma interface.
