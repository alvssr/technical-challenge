import {
  Injectable,
  Logger,
  Inject,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import {
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { EntityManager, LockMode } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { DATABASE_ORM } from '../database/database.module.js';
import {
  OutboxMessagePersistenceState,
  OutboxMessageSchema,
} from '../database/schemas/outbox-message.schema.js';
import { SQS_CLIENT } from './sqs-client.js';

const PUBLISH_INTERVAL_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private publishing = false;

  constructor(
    @Inject(DATABASE_ORM) private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  onModuleInit(): void {
    if (!process.env.SQS_WAGERS_QUEUE_URL) {
      this.logger.warn('Outbox publisher pausado: SQS_WAGERS_QUEUE_URL não configurada.');
      return;
    }

    this.timer = setInterval(() => {
      void this.publishNext().catch((error: unknown) => {
        this.logger.error(
          `Falha no ciclo do outbox (${errorName(error)}).`,
        );
      });
    }, PUBLISH_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async publishNext(): Promise<void> {
    const queueUrl = process.env.SQS_WAGERS_QUEUE_URL;
    if (!queueUrl || this.publishing) return;

    this.publishing = true;
    try {
      await this.orm.em.fork().transactional(async (em) => {
        const now = new Date();
        const message = await this.findPendingMessage(em, now);
        if (!message) return;

        try {
          await this.sqs.send(
            new SendMessageCommand({
              QueueUrl: queueUrl,
              MessageBody: JSON.stringify({
                eventId: message.id,
                eventType: message.eventType,
                aggregateId: message.aggregateId,
                occurredAt: message.occurredAt.toISOString(),
                payload: message.payload,
              }),
              MessageAttributes: {
                eventType: {
                  DataType: 'String',
                  StringValue: message.eventType,
                },
              },
            }),
          );
          await em.nativeUpdate(
            OutboxMessageSchema,
            { id: message.id, publishedAt: null },
            {
              attempts: message.attempts + 1,
              publishedAt: new Date(),
              nextAttemptAt: null,
            },
          );
        } catch (error: unknown) {
          const attempts = message.attempts + 1;
          const delay = Math.min(1_000 * 2 ** Math.min(attempts, 6), MAX_RETRY_DELAY_MS);
          await em.nativeUpdate(OutboxMessageSchema, { id: message.id }, {
            attempts,
            nextAttemptAt: new Date(Date.now() + delay),
          });
          this.logger.warn(
            `Publicação do evento ${message.id} falhou; tentativa ${attempts} será repetida (${errorName(error)}).`,
          );
        }
      });
    } finally {
      this.publishing = false;
    }
  }

  private findPendingMessage(
    em: EntityManager,
    now: Date,
  ): Promise<OutboxMessagePersistenceState | null> {
    return em.findOne<OutboxMessagePersistenceState>(
      OutboxMessageSchema,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        orderBy: { occurredAt: 'ASC' },
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
