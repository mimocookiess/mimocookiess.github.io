# Expediente e abertura excepcional

O cálculo do funcionamento fica em `store-status.js`:

- terça a domingo, aberta das 11h inclusive às 19h exclusive;
- segunda-feira fechada;
- todos os horários usam `America/Santarem`;
- pausa ou fechamento manual ainda válido prevalece sobre o expediente;
- ao vencer o retorno manual, o estado volta a ser calculado pelo expediente;
- `manual_open_until` futuro abre excepcionalmente até a meia-noite de Santarém.

O valor legado `store_mode = 'open'` continua significando funcionamento
automático. Ele não cria uma exceção. A abertura excepcional é identificada
somente pela nova coluna `manual_open_until`. Qualquer outra ação administrativa
limpa essa coluna, evitando estados conflitantes.

Site e painel leem `store_settings` diretamente. Eles recalculam o estado nos
limites do expediente, ao recuperar foco, em `pageshow`, ao retornar de uma aba
oculta e durante a sincronização periódica. O carrinho e os campos preenchidos
não são apagados quando a loja fecha.

## Limitação intencional

O bloqueio de pedidos por horário ocorre somente na interface do site, como o
fechamento manual existente. Não há validação de expediente em `create_order`
nem na Edge Function. Uma página antiga, uma chamada direta autorizada ou um
relógio incorreto no dispositivo não recebem proteção adicional do servidor.
Idempotência, Turnstile, estoque e o momento da baixa permanecem exatamente no
fluxo anterior a esta alteração.

## Estado da implantação

A migration `20261001120000_add_manual_store_opening.sql` foi aplicada em
produção em 1º de outubro de 2026 pelo controle de migrations do Supabase. A
aplicação adicionou somente `manual_open_until timestamptz`, nullable, e o grant
de UPDATE dessa coluna para `authenticated`. A validação confirmou que a RLS e a
política administrativa existente continuam restringindo a alteração ao
administrador autorizado. Nenhum registro existente foi alterado.

O frontend novo ainda precisa ser publicado. A migration é compatível com o
frontend antigo porque não remove nem modifica colunas existentes. Na publicação,
enviar juntos `store-status.js`, `script.js`, `admin/admin.js` e os dois HTMLs com
seus cache-busters. Depois, recarregar o site e o painel e validar a leitura, a
abertura excepcional e o retorno ao automático, sem criar pedidos de teste em
produção. Não é necessária outra execução manual no Supabase nem deploy da Edge
Function.

Em um ambiente novo, a ordem continua sendo migration primeiro e frontend
depois. Publicar o frontend antes da migration faz a consulta da configuração
falhar por ausência da coluna; a recuperação é aplicar a migration ou republicar
o conjunto anterior de assets.

Para reverter o schema depois de aplicado seria necessário remover a coluna,
operação destrutiva que exige nova migration, backup e autorização explícita.
Em caso de problema, prefira manter a coluna anulada e corrigir apenas o frontend.
