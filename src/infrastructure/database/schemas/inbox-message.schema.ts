import { EntitySchema } from '@mikro-orm/core';

export interface InboxMessagePersistenceState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}

export const InboxMessageSchema =
  new EntitySchema<InboxMessagePersistenceState>({
    name: 'InboxMessage',
    tableName: 'inbox_messages',
    properties: {
      consumerName: {
        type: 'string',
        primary: true,
        fieldName: 'consumer_name',
      },
      messageId: { type: 'string', primary: true, fieldName: 'message_id' },
      payloadHash: { type: 'string', fieldName: 'payload_hash' },
      receivedAt: {
        type: 'timestamptz',
        fieldName: 'received_at',
        defaultRaw: 'now()',
      },
      processedAt: {
        type: 'timestamptz',
        fieldName: 'processed_at',
        nullable: true,
      },
    },
  });
