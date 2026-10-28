import {
  Injectable,
  Inject,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createHash } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { DATABASE_ORM } from '../database/database.module.js';
import { InboxMessageSchema } from '../database/schemas/inbox-message.schema.js';
import { SQS_CLIENT } from './sqs-client.js';

const CONSUMER_NAME = 'wagering-events-v1';
const EVENT_TYPES = new Set([
  'WagerTransactionProcessed',
  'WagerTransactionRejected',
  'WalletBalanceChanged',
  'WagerTransactionPendingReference',
]);

interface IntegrationEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class InboxConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InboxConsumer.name);
  private readonly abortController = new AbortController();
  private polling = false;
  private pollTask: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(DATABASE_ORM) private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  onModuleInit(): void {
    if (!process.env.SQS_WAGERS_QUEUE_URL) {
      this.logger.warn('Inbox consumer pausado: SQS_WAGERS_QUEUE_URL não configurada.');
      return;
    }

    this.timer = setInterval(() => {
      if (!this.polling && !this.abortController.signal.aborted) {
        this.pollTask = this.pollOnce();
      }
    }, 1_000);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.abortController.abort();
    await this.pollTask;
  }

  private async pollOnce(): Promise<void> {
    const queueUrl = process.env.SQS_WAGERS_QUEUE_URL;
    if (!queueUrl || this.polling) return;

    this.polling = true;
    try {
      const response = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 10,
          VisibilityTimeout: 30,
        }),
        { abortSignal: this.abortController.signal },
      );

      for (const message of response.Messages ?? []) {
        if (!message.Body || !message.ReceiptHandle) continue;

        try {
          await this.processMessage(message.Body);
          await this.sqs.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
            { abortSignal: this.abortController.signal },
          );
        } catch (error: unknown) {
          this.logger.error(
            `Mensagem SQS não confirmada; ficará disponível para retry (${errorName(error)}).`,
          );
        }
      }
    } catch (error: unknown) {
      if (!this.abortController.signal.aborted) {
        this.logger.error(`Falha ao consultar SQS (${errorName(error)}).`);
      }
    } finally {
      this.polling = false;
    }
  }

  private async processMessage(body: string): Promise<void> {
    const event = parseIntegrationEvent(body);
    const payloadHash = createHash('sha256').update(body).digest('hex');

    await this.orm.em.fork().transactional(async (em) => {
      const existing = await em.findOne(InboxMessageSchema, {
        consumerName: CONSUMER_NAME,
        messageId: event.eventId,
      });

      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new Error(
            `ID de evento ${event.eventId} recebido com conteúdo divergente.`,
          );
        }
        return;
      }

      await this.handleIntegrationEvent(event);
      await em.insert(InboxMessageSchema, {
        consumerName: CONSUMER_NAME,
        messageId: event.eventId,
        payloadHash,
        receivedAt: new Date(),
        processedAt: new Date(),
      });
    });
  }

  private async handleIntegrationEvent(event: IntegrationEvent): Promise<void> {
    if (!EVENT_TYPES.has(event.eventType)) {
      throw new Error(`Tipo de evento não suportado: ${event.eventType}.`);
    }

    // These are integration notifications; their durable handling here is the
    // Inbox receipt. Downstream business effects belong to separate consumers.
    this.logger.debug(
      `Evento ${event.eventType} persistido na Inbox (${event.eventId}).`,
    );
  }
}

function parseIntegrationEvent(body: string): IntegrationEvent {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error('Corpo de mensagem SQS não contém JSON válido.');
  }

  if (
    !isRecord(value) ||
    typeof value.eventId !== 'string' ||
    typeof value.eventType !== 'string' ||
    typeof value.aggregateId !== 'string' ||
    typeof value.occurredAt !== 'string' ||
    !isRecord(value.payload) ||
    !EVENT_TYPES.has(value.eventType)
  ) {
    throw new Error('Envelope de evento SQS inválido ou não suportado.');
  }

  return {
    eventId: value.eventId,
    eventType: value.eventType,
    aggregateId: value.aggregateId,
    occurredAt: value.occurredAt,
    payload: value.payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
