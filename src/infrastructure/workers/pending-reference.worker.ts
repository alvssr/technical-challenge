import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { FinancialService } from '../../application/financial.service.js';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 10;

@Injectable()
export class PendingReferenceWorker
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private currentRun: Promise<void> | undefined;

  constructor(private readonly financialService: FinancialService) {}

  onModuleInit(): void {
    if (process.env.PENDING_REFERENCE_WORKER_DISABLED === 'true') return;

    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.currentRun = this.runBatch();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.currentRun;
  }

  async runOnce(): Promise<number> {
    return this.financialService.processPendingReferences(BATCH_SIZE);
  }

  private async runBatch(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao processar referências pendentes (${errorName(error)}).`,
      );
    } finally {
      this.running = false;
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
