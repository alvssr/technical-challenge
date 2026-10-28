import { EntitySchema } from '@mikro-orm/core';

export interface OutboxMessagePersistenceState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null;
  publishedAt: Date | null;
}

export const OutboxMessageSchema =
  new EntitySchema<OutboxMessagePersistenceState>({
    name: 'OutboxMessage',
    tableName: 'outbox_messages',
    properties: {
      id: { type: 'uuid', primary: true },
      aggregateId: { type: 'string', fieldName: 'aggregate_id' },
      eventType: { type: 'string', fieldName: 'event_type' },
      payload: { type: 'json' },
      occurredAt: {
        type: 'timestamptz',
        fieldName: 'occurred_at',
        defaultRaw: 'now()',
      },
      attempts: { type: 'number', default: 0 },
      nextAttemptAt: {
        type: 'timestamptz',
        fieldName: 'next_attempt_at',
        nullable: true,
      },
      publishedAt: {
        type: 'timestamptz',
        fieldName: 'published_at',
        nullable: true,
      },
    },
    indexes: [
      {
        name: 'outbox_messages_pending_idx',
        properties: ['publishedAt', 'nextAttemptAt'],
      },
    ],
    checks: [
      {
        name: 'outbox_messages_attempts_non_negative',
        expression: 'attempts >= 0',
      },
    ],
  });
