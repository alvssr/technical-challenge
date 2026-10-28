import {
  Body,
  Controller,
  Headers,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  FinancialService,
  transactionHttpStatus,
} from './financial.service.js';
import { CreateWagerTransactionDto } from './dto/create-wager-transaction.dto.js';
import { ProviderAuthGuard } from '../infrastructure/http/provider-auth.guard.js';

@Controller('wagering/transactions')
@UseGuards(ProviderAuthGuard)
export class WageringController {
  constructor(private readonly financialService: FinancialService) {}

  @Post()
  async submit(
    @Body() dto: CreateWagerTransactionDto,
    @Headers('idempotency-key')
    idempotencyKey: string | string[] | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.financialService.processTransaction(
      dto,
      idempotencyKey ?? '',
    );
    response.status(transactionHttpStatus(result.status));
    return result;
  }
}
