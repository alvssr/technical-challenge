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
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('wagering/transactions')
@UseGuards(ProviderAuthGuard)
@ApiTags('Wagering Transactions')
@ApiBearerAuth('bearer')
export class WageringController {
  constructor(private readonly financialService: FinancialService) {}

  @Post()
  @ApiOperation({
    summary: 'Processa uma transação financeira de aposta',
    description:
      'A mesma Idempotency-Key e payload retorna o resultado original. Reutilizar a chave com payload divergente retorna 409.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Chave persistente de idempotência (máximo 255 caracteres).',
    example: 'provider-local:transaction-123',
  })
  @ApiOkResponse({
    description: 'Transação processada ou rejeitada por regra financeira.',
    schema: {
      type: 'object',
      properties: {
        transactionId: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'PROCESSED' },
        balance: { $ref: '#/components/schemas/MoneyDto' },
        idempotentReplay: { type: 'boolean' },
        failureCode: { type: 'string', nullable: true },
      },
    },
  })
  @ApiAcceptedResponse({
    description: 'Operação aguardando a transação de referência (202).',
  })
  @ApiResponse({ status: 400, description: 'DTO inválido ou header ausente.' })
  @ApiResponse({ status: 401, description: 'Bearer token ausente ou inválido.' })
  @ApiConflictResponse({
    description: 'Idempotency-Key reutilizada com payload divergente.',
  })
  @ApiResponse({ status: 404, description: 'Carteira não encontrada.' })
  @ApiResponse({ status: 422, description: 'Transação rejeitada por regra financeira.' })
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
