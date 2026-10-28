import { Module } from '@nestjs/common';
import { FinancialService } from './application/financial.service.js';
import { WalletController } from './application/wallet.controller.js';
import { WageringController } from './application/wagering.controller.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { ProviderAuthGuard } from './infrastructure/http/provider-auth.guard.js';
import { HealthController } from './infrastructure/health/health.controller.js';
import { MessagingModule } from './infrastructure/messaging/messaging.module.js';

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [WalletController, WageringController, HealthController],
  providers: [FinancialService, ProviderAuthGuard],
})
export class AppModule {}
