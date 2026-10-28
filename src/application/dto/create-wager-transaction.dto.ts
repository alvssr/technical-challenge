import { Type } from 'class-transformer';
import {
  IsIn,
  IsDefined,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WagerTransactionKind } from '../../domain/transaction/enums/wager-transaction-kind.enum.js';
import { MoneyDto } from './money.dto.js';

const externallyAcceptedKinds = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

export class CreateWagerTransactionDto {
  @ApiProperty({ example: 'provider-local', maxLength: 80 })
  @IsString()
  @Length(1, 80)
  providerId!: string;

  @ApiProperty({ example: 'transaction-123', maxLength: 160 })
  @IsString()
  @Length(1, 160)
  externalTransactionId!: string;

  @ApiProperty({
    format: 'uuid',
    example: 'a12b3456-7890-4abc-8def-1234567890ab',
  })
  @IsUUID('all')
  playerId!: string;

  @ApiProperty({
    format: 'uuid',
    example: 'b12b3456-7890-4abc-8def-1234567890ab',
  })
  @IsUUID('all')
  walletId!: string;

  @ApiProperty({ example: 'round-987', maxLength: 160 })
  @IsString()
  @Length(1, 160)
  roundId!: string;

  @ApiProperty({ example: 'fortune-chimp', maxLength: 160 })
  @IsString()
  @Length(1, 160)
  gameId!: string;

  @ApiProperty({
    enum: externallyAcceptedKinds,
    example: WagerTransactionKind.Bet,
  })
  @IsIn(externallyAcceptedKinds)
  kind!: WagerTransactionKind;

  @ApiProperty({ type: () => MoneyDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @ApiPropertyOptional({
    example: 'bet-transaction-123',
    description: 'Obrigatório para REFUND e ROLLBACK.',
    maxLength: 160,
  })
  @ValidateIf(
    (dto: CreateWagerTransactionDto) =>
      dto.kind === WagerTransactionKind.Refund ||
      dto.kind === WagerTransactionKind.Rollback,
  )
  @IsString()
  @Length(1, 160)
  referenceExternalTransactionId?: string;
}
