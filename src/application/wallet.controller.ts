import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FinancialService } from './financial.service.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { ProviderAuthGuard } from '../infrastructure/http/provider-auth.guard.js';

@Controller('wallets')
@UseGuards(ProviderAuthGuard)
export class WalletController {
  constructor(private readonly financialService: FinancialService) {}

  @Post()
  create(@Body() dto: CreateWalletDto): Promise<Record<string, unknown>> {
    return this.financialService.openWallet(dto);
  }

  @Post(':walletId/reconciliation')
  reconcile(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
  ): Promise<Record<string, unknown>> {
    return this.financialService.reconcile(walletId);
  }
}
