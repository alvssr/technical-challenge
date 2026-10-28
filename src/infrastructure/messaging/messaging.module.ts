import { Global, Module } from '@nestjs/common';
import { InboxConsumer } from './sqs-inbox.consumer.js';
import { OutboxPublisher } from './outbox.publisher.js';
import { createSqsClient, SQS_CLIENT } from './sqs-client.js';

@Global()
@Module({
  providers: [
    { provide: SQS_CLIENT, useFactory: createSqsClient },
    OutboxPublisher,
    InboxConsumer,
  ],
  exports: [SQS_CLIENT],
})
export class MessagingModule {}
