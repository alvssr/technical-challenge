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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('wallets')
@UseGuards(ProviderAuthGuard)
@ApiTags('Wallets')
@ApiBearerAuth('bearer')
export class WalletController {
  constructor(private readonly financialService: FinancialService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma carteira para um jogador' })
  @ApiCreatedResponse({
    description: 'Carteira criada. Saldo inicial positivo gera OPENING e ledger.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        playerId: { type: 'string', format: 'uuid' },
        balance: {
          type: 'object',
          properties: {
            amount: { type: 'string', example: '100.00' },
            currency: { type: 'string', example: 'BRL' },
          },
        },
        version: { type: 'number', example: 1 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'DTO inválido ou campos extras.' })
  @ApiResponse({ status: 401, description: 'Bearer token ausente ou inválido.' })
  @ApiResponse({ status: 409, description: 'Carteira já existe para jogador/moeda.' })
  create(@Body() dto: CreateWalletDto): Promise<Record<string, unknown>> {
    return this.financialService.openWallet(dto);
  }

  @Post(':walletId/reconciliation')
  @ApiOperation({ summary: 'Reconcilia saldo materializado com o ledger' })
  @ApiParam({ name: 'walletId', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Resultado da reconciliação.',
    schema: {
      type: 'object',
      properties: {
        walletId: { type: 'string', format: 'uuid' },
        storedBalance: { $ref: '#/components/schemas/MoneyDto' },
        calculatedBalance: { $ref: '#/components/schemas/MoneyDto' },
        difference: { $ref: '#/components/schemas/MoneyDto' },
        consistent: { type: 'boolean' },
        checkedEntries: { type: 'integer' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Bearer token ausente ou inválido.' })
  @ApiResponse({ status: 404, description: 'Carteira não encontrada.' })
  reconcile(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
  ): Promise<Record<string, unknown>> {
    return this.financialService.reconcile(walletId);
  }
}
