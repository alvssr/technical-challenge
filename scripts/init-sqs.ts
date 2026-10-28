import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { createSqsClient } from '../src/infrastructure/messaging/sqs-client.js';

const client = createSqsClient();

try {
  const dlq = await client.send(
    new CreateQueueCommand({
      QueueName: 'wagers-dlq',
      Attributes: { MessageRetentionPeriod: '1209600' },
    }),
  );
  if (!dlq.QueueUrl) {
    throw new Error('LocalStack não retornou URL para a DLQ.');
  }

  const dlqAttributes = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlq.QueueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const dlqArn = dlqAttributes.Attributes?.QueueArn;
  if (!dlqArn) {
    throw new Error('LocalStack não retornou ARN para a DLQ.');
  }

  const queue = await client.send(
    new CreateQueueCommand({
      QueueName: 'wagers-queue',
      Attributes: {
        ReceiveMessageWaitTimeSeconds: '20',
        VisibilityTimeout: '30',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: '5',
        }),
      },
    }),
  );
  if (!queue.QueueUrl) {
    throw new Error('LocalStack não retornou URL para a fila principal.');
  }

  console.info('Filas SQS wagers-queue e wagers-dlq prontas.');
} finally {
  client.destroy();
}
