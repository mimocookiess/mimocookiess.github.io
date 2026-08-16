# Regras para agentes

Este arquivo se aplica a todo o repositório.

## Segurança e preservação do funcionamento

- Preserve o funcionamento atual dos fluxos de pedidos e de controle de estoque.
- Preserve o comportamento existente fora do escopo solicitado.
- Quando uma alteração exigir execução manual no Supabase, informe isso claramente, descrevendo o que precisa ser executado e os impactos esperados.
- Na dúvida, preserve o dado e pare. Se houver ambiguidade sobre se um registro é real ou de teste, se uma operação é segura, se um backup é suficiente ou se uma autorização cobre determinada mudança, não execute a operação destrutiva sem esclarecimento adicional.

## Supabase de produção

- Qualquer operação mutável no Supabase de produção exige autorização explícita do usuário. Isso inclui `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `DROP`, migrations, RPCs, triggers, RLS, grants, Edge Functions, secrets e configurações de produção.
- Consultas estritamente read-only podem ser executadas para auditoria e validação quando forem necessárias à tarefa.
- Uma autorização deve cobrir a operação concreta a executar. Não amplie uma autorização limitada para outras tabelas, registros, serviços ou mudanças.
- Não execute rollback em produção sem autorização explícita, exceto quando ele ainda ocorrer dentro da mesma transação não commitada.

## Operações destrutivas

São destrutivas, no mínimo: `DELETE`, `TRUNCATE`, `DROP`, remoção de coluna, alteração destrutiva de tipo, `UPDATE` em massa ou que sobrescreva dados existentes, migrations que possam eliminar ou sobrescrever informação, operações envolvendo `ON DELETE CASCADE`, limpeza de registros e qualquer mudança com risco de perda permanente de dados.

Antes de executar uma operação destrutiva, cumpra todos estes requisitos:

1. Obtenha autorização explícita do usuário.
2. Faça uma prévia read-only.
3. Identifique exatamente o conjunto afetado.
4. Produza um backup recuperável e proporcional ao risco.
5. Valide o conteúdo e a capacidade de recuperação do backup.
6. Defina uma estratégia de restauração.
7. Use uma transação quando tecnicamente possível.
8. Faça uma validação pós-operação.

Se não houver forma razoável de produzir recuperação para uma operação potencialmente destrutiva, pare e peça autorização ou instrução adicional antes de executar.

## Prévia, transação e validação

- Antes de um `DELETE` ou `UPDATE` destrutivo, execute uma consulta read-only equivalente, usando a mesma condição, e confirme quantidade, IDs/UUIDs, campos relevantes, relacionamentos afetados e efeitos de cascade.
- Sempre que possível, use UUID ou chave primária no comando mutável em vez de uma condição ampla.
- Operações de alteração devem ser transacionais sempre que possível. O fluxo esperado é: `BEGIN`, validar o estado atual, executar a alteração, validar o resultado ainda dentro da transação e somente então executar `COMMIT`.
- Se qualquer validação falhar, execute `ROLLBACK` e não continue parcialmente.
- Após a operação, confirme o estado resultante, a quantidade afetada, a integridade dos relacionamentos e a ausência de efeitos colaterais inesperados.

## Cascades e relacionamentos

- Antes de excluir um registro com foreign keys ou cascade, identifique todas as FKs relevantes, informe quais registros dependentes serão removidos e inclua esses registros no backup.
- Depois da alteração, valide que não existem registros órfãos.
- Não execute exclusões redundantes em tabelas filhas se um `ON DELETE CASCADE` válido já realizar essa remoção.

## Backups de produção

- O backup deve ser proporcional ao risco da mudança.
- Para poucos registros conhecidos, faça backup seletivo dos registros afetados e dos dependentes que possam ser removidos ou alterados, preservando UUIDs/chaves e conteúdo suficiente para reconstrução.
- Para uma mudança ampla ou estrutural, faça backup ou snapshot mais abrangente, preferencialmente pelo mecanismo nativo da infraestrutura quando disponível.
- Uma migration tecnicamente reversível não substitui um backup quando há risco de perda de dados. Rollback de schema e recuperação de dados são problemas diferentes.
- Trate backups de produção como dados sensíveis. Eles não podem ser adicionados ao repositório, commitados, enviados ao GitHub, expostos em logs públicos nem incluídos integralmente em respostas quando contiverem PII desnecessária.

## Migrations e rollback

- Nunca edite retroativamente uma migration que já tenha sido aplicada em produção. Se ela estiver errada, preserve a migration original e crie uma nova migration corretiva.
- Migrations aplicadas em produção devem permanecer no repositório e não podem ser apagadas para “limpar” o histórico. A história real do banco deve ser preservada.
- Antes de migrations críticas, documente conceitualmente o que será alterado, como desfazer o schema, quais dados precisam de backup para recuperação, as dependências e os riscos do rollback.

## Regressões em produção

Se uma alteração em produção provocar uma regressão inesperada, pare imediatamente. Não aplique automaticamente uma segunda correção improvisada. Preserve o estado, identifique a causa, informe o erro, proponha a correção mínima e obtenha nova autorização explícita antes de outra alteração em produção.

## Fluxos críticos da Mimo Cookies

Considere áreas de risco elevado:

- `orders` e `order_items`;
- `products` e estoque;
- RPC `create_order`;
- RPCs de confirmação, cancelamento e conclusão;
- RLS e grants;
- autenticação;
- Edge Function `create-order`;
- integração Turnstile;
- integrações Home Assistant e Alexa;
- pagamentos;
- analytics ligado a pedidos.

Mudanças nessas áreas devem ser pequenas, revisáveis e acompanhadas de validação.

## Idempotência, pedidos, estoque e IDs

- Não remova nem enfraqueça a idempotência baseada em `checkout_attempt_id`.
- Não permita que retries legítimos criem pedidos duplicados.
- Não altere o momento da baixa de estoque sem autorização explícita.
- Preserve o Supabase como fonte de verdade dos pedidos.
- Após exclusões, não renumere `order_number`, não execute `setval` apenas para eliminar lacunas e não reutilize números consumidos. Aceite gaps como comportamento normal de sequences.

## PII e dados sensíveis

- Considere sensíveis dados como nome, telefone, endereço, bairro, complemento, referência, observações e mensagem do WhatsApp.
- Não inclua PII em analytics, logs desnecessários, commits, arquivos de teste versionados, documentação pública ou backups versionados.
- Minimize a exposição de dados reais em saídas de comandos e respostas; quando detalhes forem necessários para validação, apresente apenas o mínimo indispensável.

## Secrets e credenciais

- Nunca exponha ou coloque no frontend, Git, logs, documentação, commits ou respostas públicas: chaves `service_role`, API secrets, webhook secrets, tokens privados, senhas, credenciais, Measurement Protocol API secret ou qualquer outra chave privada.
- Measurement IDs públicos não são secrets, mas devem ser tratados separadamente de credenciais.

## Git e alterações no código

- Não crie commit sem solicitação quando a tarefa pedir apenas alterações na working tree.
- Nunca execute `git push` sem autorização explícita do usuário.
- Prefira mudanças pequenas, localizadas e fáceis de revisar.
- Preserve alterações preexistentes do usuário e não modifique arquivos fora do escopo.
- Backups de produção devem permanecer fora do Git.
- Depois de qualquer alteração, sempre apresente:
  1. um resumo objetivo do que foi alterado;
  2. o resultado do `git diff` relevante para revisão;
  3. o resultado de `git status`;
  4. o resultado de `git diff --check`.

## Relatório após mudança de produção

Toda tarefa que efetivamente alterar produção deve terminar informando:

- estado antes;
- autorização recebida;
- backup realizado, quando aplicável;
- alteração executada;
- horário aproximado;
- estado depois;
- quantidade de registros afetados;
- testes executados;
- integridade verificada;
- possibilidade de rollback;
- pendências.
