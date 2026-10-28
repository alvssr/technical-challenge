# Arquitetura

## Escopo estratégico: fatia vertical síncrona

O foco desta implementação é concluir um caminho financeiro de ponta a ponta
antes de adicionar a complexidade de consumidores assíncronos: validação HTTP,
decisão de domínio, controle de concorrência, persistência PostgreSQL, ledger,
idempotência, outbox e resposta. O objetivo é que uma operação aceite ou
rejeite uma alteração financeira de forma consistente, sem depender de uma
entrega SQS para confirmar o saldo.

Esse recorte reduz riscos de lost updates e efeitos duplicados, e torna o
resultado verificável pela reconciliação do ledger. O publisher da outbox e o
consumidor SQS com Inbox persistente agora estão implementados. O worker que
retoma transações `PENDING_REFERENCE` quando a referência chega posteriormente
continua pendente.

## Camadas e responsabilidades

- **Domínio (`src/domain`)**: `Money`, `Wallet`, `WagerTransaction` e
  `WalletLedgerEntry` aplicam regras financeiras e não importam NestJS ou
  MikroORM. `Money` usa `decimal.js`, mantém a precisão de `numeric(18, 2)` e
  rejeita números de ponto flutuante/notação científica.
- **Aplicação (`src/application`)**: DTOs validam a fronteira HTTP;
  `FinancialService` coordena o domínio, a transação SQL, idempotência,
  outbox e resposta.
- **Infraestrutura (`src/infrastructure`)**: NestJS, autenticação, health
  checks, configuração do MikroORM, schemas de persistência e migrations.
  `EntitySchema` é tipado com interfaces de estado em vez de instruir o ORM a
  instanciar agregados com construtor privado.

Essa separação permite testar invariantes do domínio sem banco e manter
detalhes de persistência fora das entidades. A aplicação persiste estado
financeiro como strings decimais; não converte dinheiro para `number`.

## Consistência financeira e concorrência

Cada operação financeira executa em um único `EntityManager.transactional()`.
Para transações sobre uma carteira existente, o serviço obtém
`LockMode.PESSIMISTIC_WRITE` na linha daquela carteira antes de reidratar seu
estado e aplicar o débito/crédito. O lock é por `walletId`, não global:
operações da mesma carteira são serializadas pelo PostgreSQL, enquanto
carteiras diferentes podem avançar em paralelo.

A mesma transação SQL engloba o estado da carteira, a transação de aposta, o
lançamento de ledger quando há alteração de saldo e os eventos da outbox.
Assim, não há confirmação de saldo sem seu registro auditável nem evento
outbox confirmado para uma alteração que foi revertida.

O saldo é verificado no domínio e protegido também por `CHECK (balance >= 0)`
no PostgreSQL. O `WalletLedgerEntry` valida a igualdade entre saldo anterior,
direção, quantia e saldo posterior. `LOSS` não altera saldo e não cria
lançamento; transações rejeitadas também não criam lançamento. Uma reversão
que não pode ser aplicada sem saldo negativo é rejeitada com um código de
falha auditável. `WalletBalanceChanged` só é criado quando o saldo muda.

O histórico implementado é um ledger imutável de movimentos da carteira, com
saldo anterior/posterior. Ele fornece trilha de auditoria e reconciliação, mas
não é um razão contábil de partidas dobradas completo: para contabilidade
formal, cada movimento deverá gerar lançamentos balanceados entre contas
contábeis de origem e destino.

## Idempotência e referências

O header `Idempotency-Key` identifica a repetição do pedido. O serviço calcula
SHA-256 de uma representação canônica dos campos de negócio (incluindo valores
monetários normalizados), pesquisa o registro persistido e:

1. Retorna a resposta original, com `idempotentReplay: true`, se a chave e o
   hash corresponderem.
2. Retorna HTTP 409 se a chave existir com outro payload.
3. Persiste uma nova operação se a chave ainda não tiver sido utilizada.

Há também índices únicos para `idempotency_key` e
`(provider_id, external_transaction_id)`. O serviço consulta idempotência antes
e depois de obter o lock da carteira, para cobrir requisições concorrentes, e
trata violações de unicidade como conflitos/replay, sem permitir um segundo
efeito financeiro.

`REFUND` e `ROLLBACK` exigem referência. Uma referência que ainda não existe é
persistida com `PENDING_REFERENCE`, e um evento correspondente é gravado na
outbox. A validação de referência existente verifica status, jogador, carteira,
rodada, moeda, valor e tipo permitido; uma referência inválida é rejeitada.
Ainda não há worker para localizar a referência que chegar depois e retomar a
operação. Portanto, o registro pendente é persistido, mas não é
automaticamente reprocessado nesta entrega.

## Dados e restrições PostgreSQL

Os schemas MikroORM são interfaces explícitas de estado e não classes de
domínio. Migrations versionadas criam as tabelas e impõem invariantes no banco,
incluindo:

- saldo não negativo e moeda em formato de três letras maiúsculas;
- carteira única por `(player_id, currency)`;
- unicidade de chave de idempotência e do identificador externo por provedor;
- referência estrangeira de transações/lançamentos para carteira e transação;
- consistência entre direção, saldo anterior, quantia e saldo posterior do
  ledger;
- no máximo uma reversão do mesmo tipo para a transação de referência.

As constraints do banco são uma última barreira de integridade, não substituem
validações nos DTOs ou invariantes do domínio. Escritas e filtros usam APIs
parametrizadas do MikroORM; a verificação de banco nos health checks executa
somente uma consulta constante (`select 1`).

**Limite conhecido de sincronização do schema:** as foreign keys foram criadas
por migrations, enquanto os schemas tipados representam suas colunas UUID como
valores escalares (sem associações MikroORM). Por isso,
`schema:update --dump`/`migration:check` atualmente sugerem remover essas quatro
foreign keys. Não aplique `schema:update --run`: as migrations são a fonte de
verdade e a remoção reduziria a integridade referencial. Eliminar essa
divergência exige modelar associações MikroORM mantendo a separação entre o
domínio e os tipos de persistência.

## Outbox, Inbox e SQS

### Implementado: publisher e consumidor

Eventos como `WagerTransactionProcessed`, `WagerTransactionRejected`,
`WalletBalanceChanged` e `WagerTransactionPendingReference` são gravados em
`outbox_messages` na mesma transação SQL que a operação financeira. Isso
resolve o problema de dual write entre confirmar o saldo e registrar a
intenção de publicar um evento.

`OutboxPublisher` procura mensagens não publicadas cuja próxima tentativa já
venceu, usando lock `PESSIMISTIC_PARTIAL_WRITE` (PostgreSQL `SKIP LOCKED`) para
permitir múltiplas instâncias. Publica a mensagem e grava `published_at` só
depois do aceite do SQS. Falhas aumentam `attempts` e agendam nova tentativa
com backoff exponencial. Se o processo cair depois do envio e antes do commit,
a mensagem pode ser publicada novamente; por isso a entrega é **at-least-once**,
não exactly-once.

`InboxConsumer` faz long polling, valida o envelope e deduplica usando
`(consumer_name, event_id)` na Inbox. A inserção e o processamento do envelope
ocorrem dentro da mesma transação SQL; o `DeleteMessage` (ack) só acontece
depois do commit. Se o processo cair antes do ack, a mensagem será entregue
novamente e reconhecida como duplicata. Um payload divergente para o mesmo ID
não é confirmado, permitindo retry/DLQ em vez de descartar corrupção.

Os eventos suportados são notificações de integração. Neste serviço, o
consumidor valida e registra a recepção durável na Inbox; efeitos de negócio
específicos de outros bounded contexts devem ser implementados por seus
consumidores próprios, não aplicados novamente ao saldo já confirmado.

O LocalStack inicializa `wagers-queue` com long polling, timeout de visibilidade
e redrive para `wagers-dlq` após cinco entregas. O `/health/ready` faz consulta
real ao PostgreSQL e ao atributo da fila SQS; readiness indica dependências
acessíveis, não ausência de backlog ou processamento sem falhas.

### Ainda pendente

O worker que reprocessa operações `PENDING_REFERENCE` quando uma referência
chega depois continua pendente. Também são necessários alertas operacionais
para DLQ/backlog e testes de falhas distribuídas em múltiplas instâncias antes
de produção.

## Segurança HTTP e autenticação

Helmet aplica cabeçalhos de segurança. O `ValidationPipe` global habilita
`whitelist`, `forbidNonWhitelisted` e `forbidUnknownValues`, sem conversão
implícita de valores; DTOs validam UUIDs, campos e valores monetários. Só
`/health/live` e `/health/ready` são públicos. Endpoints financeiros exigem
`API_BEARER_TOKEN` e falham fechados quando ele não está configurado ou não
atende ao tamanho mínimo.

Essa autenticação é um token compartilhado para a fatia local, não uma
identidade de provedor nem um IdP. Antes de produção, adotar credenciais
separadas por provedor (por exemplo, HMAC com assinatura do corpo canônico,
timestamp/nonce contra replay, rotação e armazenamento em secret manager) e
políticas de autorização por identidade. A idempotência protege repetição de
efeito financeiro; não substitui autenticação ou proteção criptográfica do
transporte.

Não registrar tokens, segredos ou corpo financeiro completo. Logs JSON
sanitizados, métricas e tracing de produção devem ser conectados antes de
operar o sistema; atualmente isso não é implementado nesta fatia.

## Testes e comandos

Os testes cobrem value objects e invariantes do domínio, além de integração
HTTP com PostgreSQL e LocalStack reais: concorrência de débitos sobre uma
carteira, replay idempotente, conflito de payload, reconciliação, health
público, autenticação, rejeição de propriedades extras e propagação outbox →
SQS → Inbox. O teste concorrente usa duas apostas de R$ 80,00 sobre saldo de
R$ 100,00; deve resultar em apenas um débito aceito e saldo final
reconciliável.

Ainda devem ser ampliados os cenários de carga/concorrência distribuída, SQS e
falhas/retries. Com PostgreSQL e LocalStack disponíveis:

```bash
bun install
docker compose up -d
bun run migration:up
bun run lint
bun run build
bun test
bun run migration:check
```

Veja [README.md](./README.md) para configuração local e chamadas HTTP.
