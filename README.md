# Wagering Processor

Serviço de processamento financeiro de apostas construído com Bun, TypeScript
strict, NestJS, MikroORM e PostgreSQL. Inclui transações SQL, lock por carteira,
idempotência persistente, ledger, Transactional Outbox, publisher SQS e
consumidor com Inbox.

## Pré-requisitos

- Git e Docker Desktop/Docker Engine com Docker Compose.
- Bun 1.x só é necessário para executar e testar sem Docker.

## Clonar e iniciar a stack completa

```bash
git clone <URL-DO-REPOSITORIO> technical-challenge
cd technical-challenge
docker compose up --build
```

O Compose inicia PostgreSQL 16, LocalStack SQS, constrói a aplicação Bun,
aguarda as dependências ficarem saudáveis, provisiona fila/DLQ com o SDK SQS e
executa as migrations antes de iniciar o NestJS. O endpoint da aplicação fica
em `http://localhost:3000`.
Para rodar em segundo plano, adicione `-d`.

O Compose fornece um token de desenvolvimento local se
`API_BEARER_TOKEN` não estiver definido. **Troque-o antes de compartilhar o
ambiente e nunca use esse valor em produção.** Configure-o pelo `.env` local
(copie `.env.example`) ou pela variável do shell; `.env` é ignorado pelo Git.
Exemplo no PowerShell:

```powershell
Copy-Item .env.example .env
$env:API_BEARER_TOKEN = "gere-um-segredo-aleatorio-com-pelo-menos-32-caracteres"
docker compose up --build
```

### Desenvolvimento fora do Docker

Para executar Bun/NestJS no host, use Docker apenas para as dependências:

```bash
bun install
docker compose up -d postgres localstack
bun run sqs:init
bun run migration:up
bun run start:dev
```

Configure o token no shell antes de iniciar a API. `.env.example` contém
valores locais de exemplo, incluindo o endpoint SQS pelo hostname `localhost`.
O worker Outbox/Inbox fica ativo quando `SQS_WAGERS_QUEUE_URL` está configurado.

### Verificações

```bash
bun run lint
bun run build
bun test
bun run migration:check
```

`bun test` inclui testes unitários, HTTP e de integração do fluxo
PostgreSQL → Outbox → SQS → Inbox. Suba PostgreSQL/LocalStack e aplique as
migrations antes de executar a suíte no host. A imagem Compose aplica migrations
automaticamente ao iniciar.
No momento, `migration:check` ainda detecta as quatro foreign keys
gerenciadas pelas migrations como divergência, porque os schemas MikroORM
representam as referências como UUIDs escalares. Não use `schema:update --run`
para removê-las; esse desalinhamento está detalhado em
[ARCHITECTURE.md](./ARCHITECTURE.md).

## API implementada

As rotas financeiras exigem `Authorization: Bearer <API_BEARER_TOKEN>`. O token
é uma credencial compartilhada para desenvolvimento da fatia vertical, não um
Identity Provider nem uma estratégia adequada para separar provedores em
produção. `/health/live` e `/health/ready` são públicos.

### Swagger / OpenAPI

Com a aplicação no ar, abra `http://localhost:3000/docs` para explorar e testar
as rotas. Use o botão **Authorize** e informe o token configurado em
`API_BEARER_TOKEN` (sem escrever o prefixo `Bearer` no campo). Para endpoints
financeiros, o Swagger incluirá o header de autorização; ao testar apostas,
preencha também `Idempotency-Key`. O documento OpenAPI em JSON fica disponível
em `http://localhost:3000/docs/openapi.json`.

### Criar carteira

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Authorization: Bearer $API_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "initialBalance": { "amount": "100.00", "currency": "BRL" }
  }'
```

Saldo inicial positivo cria uma transação interna `OPENING`, um crédito no
ledger e eventos na outbox dentro do mesmo commit SQL. A carteira é única por
`playerId` e moeda.

### Apostar (BET)

Use o `walletId` retornado na criação da carteira:
os exemplos abaixo usam sintaxe Bash. No PowerShell, use `curl.exe` e substitua
`$API_BEARER_TOKEN` por `$env:API_BEARER_TOKEN`.

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Authorization: Bearer $API_BEARER_TOKEN" \
  -H "Idempotency-Key: provider-a:transaction-123" \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "COLOQUE-AQUI-O-WALLET-ID",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }'
```

Uma repetição com a mesma chave e os mesmos dados de negócio devolve a resposta
original com `"idempotentReplay": true`; nenhum segundo débito é feito. Para
testar, envie novamente exatamente o mesmo `curl`.

Se a mesma chave for reutilizada com um valor alterado, por exemplo
`"amount": "26.00"`, a resposta é HTTP `409 Conflict`. O `payloadHash` é
SHA-256 de JSON canônico dos campos de negócio normalizados; o header de
idempotência e metadados de transporte não fazem parte do hash.

Uma aposta sem saldo suficiente é persistida com status `REJECTED` e
`failureCode: "INSUFFICIENT_FUNDS"`, sem alterar saldo ou gerar lançamento no
ledger.

### Reconciliação

```bash
curl -X POST http://localhost:3000/wallets/COLOQUE-AQUI-O-WALLET-ID/reconciliation \
  -H "Authorization: Bearer $API_BEARER_TOKEN"
```

A resposta compara o saldo materializado com a soma dos lançamentos do ledger.
Uma divergência é reportada em `consistent: false`; o serviço não corrige o
saldo silenciosamente.

### Health checks

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

O readiness retorna HTTP 500 com o estado das dependências quando PostgreSQL
ou a fila SQS não respondem.

## Segurança e limites desta entrega

- DTOs com validação estrita e `whitelist`/`forbidNonWhitelisted` rejeitam
  propriedades inesperadas.
- Helmet aplica cabeçalhos HTTP de segurança.
- Credenciais inválidas não são registradas ou retornadas em respostas.
- Consultas e alterações são feitas pelo MikroORM com parâmetros; nenhum valor
  da requisição é concatenado em SQL.
- O PostgreSQL aplica constraints para saldo não negativo, unicidade,
  consistência aritmética dos lançamentos e relacionamentos financeiros.
- A autenticação usa um bearer token único de desenvolvimento. Em produção,
  deve ser substituída por autenticação de provedores apropriada (por exemplo,
  integração com um Identity Provider) e gestão segura de segredos.

## Estado do escopo distribuído

As alterações financeiras e os eventos Outbox são gravados no mesmo commit.
O publisher faz tentativas com backoff e sem marcar como publicado antes do
SQS aceitar a mensagem; após crash na janela de envio/commit, uma mensagem pode
ser duplicada (entrega at-least-once). O consumidor grava a Inbox na transação
antes de confirmar a mensagem no SQS, usando `eventId` estável para deduplicar
reentregas. A fila LocalStack tem DLQ/redrive para cinco tentativas. Ainda falta
o worker que retoma automaticamente transações `PENDING_REFERENCE` quando a
referência chegar posteriormente.

Veja [ARCHITECTURE.md](./ARCHITECTURE.md) para as decisões, riscos e desenho de
extensão, e [STUDY_GUIDE.md](./STUDY_GUIDE.md) para o roteiro didático.
