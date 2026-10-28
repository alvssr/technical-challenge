import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
} from '@nestjs/common';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { DATABASE_ORM } from '../database/database.module.js';
import { SQS_CLIENT } from '../messaging/sqs-client.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_ORM) private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    const queueUrl = process.env.SQS_WAGERS_QUEUE_URL;
    if (!queueUrl) {
      throw new InternalServerErrorException({
        status: 'not_ready',
        dependencies: { postgres: 'unknown', sqs: 'not_configured' },
      });
    }

    const checks = await Promise.allSettled([
      this.orm.em.getConnection().execute('select 1'),
      this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['QueueArn'],
        }),
      ),
    ]);

    if (checks.some((check) => check.status === 'rejected')) {
      throw new InternalServerErrorException({
        status: 'not_ready',
        dependencies: {
          postgres: checks[0]?.status === 'fulfilled' ? 'up' : 'down',
          sqs: checks[1]?.status === 'fulfilled' ? 'up' : 'down',
        },
      });
    }

    return { status: 'ready' };
  }
}
