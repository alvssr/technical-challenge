import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { AppModule } from '../src/app.module.js';
import { DATABASE_ORM } from '../src/infrastructure/database/database.module.js';
import { InboxMessageSchema } from '../src/infrastructure/database/schemas/inbox-message.schema.js';
import { OutboxMessageSchema } from '../src/infrastructure/database/schemas/outbox-message.schema.js';
import { WagerTransactionSchema } from '../src/infrastructure/database/schemas/wager-transaction.schema.js';
import { PendingReferenceWorker } from '../src/infrastructure/workers/pending-reference.worker.js';
import { OutboxPublisher } from '../src/infrastructure/messaging/outbox.publisher.js';

const apiToken = 'integration-test-secret-that-is-at-least-32-characters';

describe('financial HTTP integration (PostgreSQL)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.API_BEARER_TOKEN = apiToken;
    process.env.PENDING_REFERENCE_WORKER_DISABLED = 'true';
    process.env.AWS_REGION ??= 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID ??= 'test';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
    process.env.SQS_ENDPOINT ??= 'http://localhost:4566';
    process.env.SQS_WAGERS_QUEUE_URL ??= `${process.env.SQS_ENDPOINT}/000000000000/wagers-queue`;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serializa débitos concorrentes e mantém replay e ledger consistentes', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .set('Authorization', `Bearer ${apiToken}`)
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      })
      .expect(201);
    const walletId = walletResponse.body.id as string;

    const betA = {
      providerId: 'provider-integration',
      externalTransactionId: `bet-a-${randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-integration',
      gameId: 'game-integration',
      kind: 'BET',
      money: { amount: '80.00', currency: 'BRL' },
    };
    const betB = {
      ...betA,
      externalTransactionId: `bet-b-${randomUUID()}`,
    };

    const concurrentResults = await Promise.all([
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Authorization', `Bearer ${apiToken}`)
        .set('Idempotency-Key', `idem-${randomUUID()}`)
        .send(betA),
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Authorization', `Bearer ${apiToken}`)
        .set('Idempotency-Key', `idem-${randomUUID()}`)
        .send(betB),
    ]);

    expect(
      concurrentResults
        .map((result) => result.status)
        .sort((left, right) => left - right),
    ).toEqual([200, 422]);
    expect(
      concurrentResults.filter((result) => result.body.status === 'PROCESSED'),
    ).toHaveLength(1);
    expect(
      concurrentResults.find((result) => result.body.status === 'REJECTED')
        ?.body.failureCode,
    ).toBe('INSUFFICIENT_FUNDS');

    const reconciliation = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .set('Authorization', `Bearer ${apiToken}`)
      .expect(201);
    expect(reconciliation.body.consistent).toBe(true);
    expect(reconciliation.body.storedBalance.amount).toBe('20.00');
    expect(reconciliation.body.checkedEntries).toBe(2);

    const replayKey = `replay-${randomUUID()}`;
    const replayPayload = {
      ...betA,
      externalTransactionId: `replay-${randomUUID()}`,
    };
    const original = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Authorization', `Bearer ${apiToken}`)
      .set('Idempotency-Key', replayKey)
      .send({ ...replayPayload, money: { amount: '1.00', currency: 'BRL' } })
      .expect(200);
    const replay = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Authorization', `Bearer ${apiToken}`)
      .set('Idempotency-Key', replayKey)
      .send({ ...replayPayload, money: { amount: '1.00', currency: 'BRL' } })
      .expect(200);

    expect(original.body.idempotentReplay).toBe(false);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.transactionId).toBe(original.body.transactionId);
    expect(replay.body.balance).toEqual(original.body.balance);

    await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Authorization', `Bearer ${apiToken}`)
      .set('Idempotency-Key', replayKey)
      .send({ ...replayPayload, money: { amount: '2.00', currency: 'BRL' } })
      .expect(409);

    const afterReplay = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .set('Authorization', `Bearer ${apiToken}`)
      .expect(201);
    expect(afterReplay.body.consistent).toBe(true);
  });

  it('permite reverter um refund, mas não creditar duas vezes a mesma aposta', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .set(...authorizationHeader())
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      })
      .expect(201);
    const walletId = walletResponse.body.id as string;
    const betId = `bet-${randomUUID()}`;
    const refundId = `refund-${randomUUID()}`;
    const submit = (
      kind: string,
      externalTransactionId: string,
      amount: string,
      referenceExternalTransactionId?: string,
    ) =>
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set(...authorizationHeader())
        .set('Idempotency-Key', `idem-${randomUUID()}`)
        .send({
          providerId: 'provider-reversals',
          externalTransactionId,
          playerId,
          walletId,
          roundId: 'round-reversals',
          gameId: 'game-reversals',
          kind,
          money: { amount, currency: 'BRL' },
          ...(referenceExternalTransactionId
            ? { referenceExternalTransactionId }
            : {}),
        });

    await submit('BET', betId, '25.00').expect(200);
    await submit('REFUND', refundId, '25.00', betId).expect(200);

    const rollbackRefund = await submit(
      'ROLLBACK',
      `rollback-refund-${randomUUID()}`,
      '25.00',
      refundId,
    ).expect(200);
    expect(rollbackRefund.body.status).toBe('PROCESSED');

    const duplicateReversal = await submit(
      'ROLLBACK',
      `rollback-bet-${randomUUID()}`,
      '25.00',
      betId,
    ).expect(422);
    expect(duplicateReversal.body.failureCode).toBe('DUPLICATE_TRANSACTION');

    const reconciliation = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .set(...authorizationHeader())
      .expect(201);
    expect(reconciliation.body.consistent).toBe(true);
    expect(reconciliation.body.storedBalance.amount).toBe('75.00');
  });

  it('não deixa uma reversão rejeitada bloquear uma tentativa posterior válida', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .set(...authorizationHeader())
      .send({
        playerId,
        initialBalance: { amount: '10.00', currency: 'BRL' },
      })
      .expect(201);
    const walletId = walletResponse.body.id as string;
    const winId = `win-${randomUUID()}`;
    const submit = (
      kind: string,
      externalTransactionId: string,
      amount: string,
      referenceExternalTransactionId?: string,
    ) =>
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set(...authorizationHeader())
        .set('Idempotency-Key', `idem-${randomUUID()}`)
        .send({
          providerId: 'provider-reversal-retry',
          externalTransactionId,
          playerId,
          walletId,
          roundId: 'round-reversal-retry',
          gameId: 'game-reversal-retry',
          kind,
          money: { amount, currency: 'BRL' },
          ...(referenceExternalTransactionId
            ? { referenceExternalTransactionId }
            : {}),
        });

    await submit('WIN', winId, '20.00').expect(200);
    await submit('BET', `bet-${randomUUID()}`, '30.00').expect(200);

    const rejectedRollback = await submit(
      'ROLLBACK',
      `rollback-rejected-${randomUUID()}`,
      '20.00',
      winId,
    ).expect(422);
    expect(rejectedRollback.body.failureCode).toBe(
      'REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE',
    );

    await submit('WIN', `win-recovery-${randomUUID()}`, '20.00').expect(200);

    const successfulRetry = await submit(
      'ROLLBACK',
      `rollback-retry-${randomUUID()}`,
      '20.00',
      winId,
    ).expect(200);
    expect(successfulRetry.body.status).toBe('PROCESSED');

    const reconciliation = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .set(...authorizationHeader())
      .expect(201);
    expect(reconciliation.body.consistent).toBe(true);
    expect(reconciliation.body.storedBalance.amount).toBe('0.00');
  });

  it('deixa health público e rejeita autenticação ausente e campos extras', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);

    await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: randomUUID(),
        initialBalance: { amount: '0.00', currency: 'BRL' },
      })
      .expect(401);

    await request(app.getHttpServer())
      .post('/wallets')
      .set('Authorization', `Bearer ${apiToken}`)
      .send({
        playerId: randomUUID(),
        initialBalance: { amount: '0.00', currency: 'BRL' },
        isAdmin: true,
      })
      .expect(400);
  });

  it('reprocessa um rollback que chegou antes do BET referenciado', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .set(...authorizationHeader())
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      })
      .expect(201);
    const walletId = walletResponse.body.id as string;
    const betId = `bet-late-${randomUUID()}`;
    const rollbackId = `rollback-early-${randomUUID()}`;
    const rollbackKey = `idem-${randomUUID()}`;
    const requestTransaction = (
      kind: string,
      externalTransactionId: string,
      referenceExternalTransactionId?: string,
      idempotencyKey = `idem-${randomUUID()}`,
    ) =>
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set(...authorizationHeader())
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: 'provider-out-of-order',
          externalTransactionId,
          playerId,
          walletId,
          roundId: 'round-out-of-order',
          gameId: 'game-out-of-order',
          kind,
          money: { amount: '25.00', currency: 'BRL' },
          ...(referenceExternalTransactionId
            ? { referenceExternalTransactionId }
            : {}),
        });

    const pending = await requestTransaction(
      'ROLLBACK',
      rollbackId,
      betId,
      rollbackKey,
    ).expect(202);
    expect(pending.body.status).toBe('PENDING_REFERENCE');

    const bet = await requestTransaction('BET', betId).expect(200);
    expect(bet.body.balance.amount).toBe('75.00');

    const processedCount = await app.get(PendingReferenceWorker).runOnce();
    expect(processedCount).toBe(1);

    const transaction = await app
      .get<MikroORM>(DATABASE_ORM)
      .em.fork()
      .findOneOrFail(WagerTransactionSchema, {
        id: pending.body.transactionId,
      });
    expect(transaction.status).toBe('PROCESSED');
    expect(transaction.referenceAttempts).toBe(1);
    expect(transaction.responseBalance).toBe('100.00');

    const replay = await requestTransaction(
      'ROLLBACK',
      rollbackId,
      betId,
      rollbackKey,
    ).expect(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.transactionId).toBe(transaction.id);
    expect(replay.body.status).toBe('PROCESSED');
    expect(replay.body.balance.amount).toBe('100.00');

    const reconciliation = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .set(...authorizationHeader())
      .expect(201);
    expect(reconciliation.body.consistent).toBe(true);
    expect(reconciliation.body.storedBalance.amount).toBe('100.00');
    expect(reconciliation.body.checkedEntries).toBe(3);
  });

  it('coordena dois workers concorrentes sem processar duas vezes a mesma pendência', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .set(...authorizationHeader())
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      })
      .expect(201);
    const walletId = walletResponse.body.id as string;
    const providerId = 'provider-pending-workers';
    const roundId = 'round-pending-workers';
    const gameId = 'game-pending-workers';
    const betIds = [`bet-a-${randomUUID()}`, `bet-b-${randomUUID()}`];
    const submit = (
      kind: string,
      externalTransactionId: string,
      referenceExternalTransactionId?: string,
    ) =>
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set(...authorizationHeader())
        .set('Idempotency-Key', `idem-${randomUUID()}`)
        .send({
          providerId,
          externalTransactionId,
          playerId,
          walletId,
          roundId,
          gameId,
          kind,
          money: { amount: '20.00', currency: 'BRL' },
          ...(referenceExternalTransactionId
            ? { referenceExternalTransactionId }
            : {}),
        });

    const pendingRollbacks = await Promise.all(
      betIds.map((betId) =>
        submit('ROLLBACK', `rollback-${randomUUID()}`, betId).expect(202),
      ),
    );
    await Promise.all(betIds.map((betId) => submit('BET', betId).expect(200)));

    const worker = app.get(PendingReferenceWorker);
    const processedCounts = await Promise.all([
      worker.runOnce(),
      worker.runOnce(),
    ]);
    expect(processedCounts.reduce((total, count) => total + count, 0)).toBe(2);

    const orm = app.get<MikroORM>(DATABASE_ORM);
    const resolved = await orm.em.fork().find(WagerTransactionSchema, {
      id: { $in: pendingRollbacks.map((result) => result.body.transactionId) },
    });
    expect(resolved).toHaveLength(2);
    expect(
      resolved.every((transaction) => transaction.status === 'PROCESSED'),
    ).toBe(true);

    const reconciliation = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .set(...authorizationHeader())
      .expect(201);
    expect(reconciliation.body.consistent).toBe(true);
    expect(reconciliation.body.storedBalance.amount).toBe('100.00');
    expect(reconciliation.body.checkedEntries).toBe(5);
  });

  it('aplica backoff e rejeita pendência sem referência após cinco tentativas', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .set(...authorizationHeader())
      .send({
        playerId,
        initialBalance: { amount: '50.00', currency: 'BRL' },
      })
      .expect(201);
    const walletId = walletResponse.body.id as string;
    const pending = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set(...authorizationHeader())
      .set('Idempotency-Key', `idem-${randomUUID()}`)
      .send({
        providerId: 'provider-missing-reference',
        externalTransactionId: `refund-${randomUUID()}`,
        playerId,
        walletId,
        roundId: 'round-missing-reference',
        gameId: 'game-missing-reference',
        kind: 'REFUND',
        referenceExternalTransactionId: `missing-bet-${randomUUID()}`,
        money: { amount: '10.00', currency: 'BRL' },
      })
      .expect(202);

    const orm = app.get<MikroORM>(DATABASE_ORM);
    const worker = app.get(PendingReferenceWorker);
    expect(await worker.runOnce()).toBe(1);
    let transaction = await orm.em
      .fork()
      .findOneOrFail(WagerTransactionSchema, {
        id: pending.body.transactionId,
      });
    expect(transaction.status).toBe('PENDING_REFERENCE');
    expect(transaction.referenceAttempts).toBe(1);
    expect(transaction.referenceNextAttemptAt?.getTime()).toBeGreaterThan(
      Date.now(),
    );

    await orm.em.fork().nativeUpdate(
      WagerTransactionSchema,
      { id: transaction.id },
      {
        referenceAttempts: 4,
        referenceNextAttemptAt: new Date(0),
      },
    );
    expect(await worker.runOnce()).toBe(1);

    transaction = await orm.em
      .fork()
      .findOneOrFail(WagerTransactionSchema, { id: transaction.id });
    expect(transaction.status).toBe('REJECTED');
    expect(transaction.failureCode).toBe('MISSING_REFERENCE');
    expect(transaction.referenceAttempts).toBe(5);
    expect(transaction.referenceNextAttemptAt).toBeNull();

    const reconciliation = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .set(...authorizationHeader())
      .expect(201);
    expect(reconciliation.body.consistent).toBe(true);
    expect(reconciliation.body.storedBalance.amount).toBe('50.00');
  });

  it('publica eventos da outbox e os deduplica na Inbox persistente', async () => {
    const playerId = randomUUID();
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .set(...authorizationHeader())
      .send({
        playerId,
        initialBalance: { amount: '5.00', currency: 'BRL' },
      })
      .expect(201);
    const walletId = walletResponse.body.id as string;
    const orm = app.get<MikroORM>(DATABASE_ORM);
    const em = orm.em.fork();
    const outboxMessages = await em.find(OutboxMessageSchema, {
      aggregateId: walletId,
    });

    expect(outboxMessages.length).toBeGreaterThan(0);

    const expectedMessageIds = outboxMessages.map((message) => message.id);
    const publisher = app.get(OutboxPublisher);
    let publishedMessages = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await publisher.publishNext();
      publishedMessages = await em.count(OutboxMessageSchema, {
        id: { $in: expectedMessageIds },
        publishedAt: { $ne: null },
      });
      if (publishedMessages === expectedMessageIds.length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(publishedMessages).toBe(expectedMessageIds.length);

    let inboxCount = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      inboxCount = await em.count(InboxMessageSchema, {
        consumerName: 'wagering-events-v1',
        messageId: { $in: expectedMessageIds },
      });
      if (inboxCount === expectedMessageIds.length) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(inboxCount).toBe(expectedMessageIds.length);
    publishedMessages = await em.count(OutboxMessageSchema, {
      id: { $in: expectedMessageIds },
      publishedAt: { $ne: null },
    });
    expect(publishedMessages).toBe(expectedMessageIds.length);
  }, 35_000);
});

function authorizationHeader(): [string, string] {
  return ['Authorization', `Bearer ${apiToken}`];
}
