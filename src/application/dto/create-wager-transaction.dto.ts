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
  @IsString()
  @Length(1, 80)
  providerId!: string;

  @IsString()
  @Length(1, 160)
  externalTransactionId!: string;

  @IsUUID('all')
  playerId!: string;

  @IsUUID('all')
  walletId!: string;

  @IsString()
  @Length(1, 160)
  roundId!: string;

  @IsString()
  @Length(1, 160)
  gameId!: string;

  @IsIn(externallyAcceptedKinds)
  kind!: WagerTransactionKind;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @ValidateIf(
    (dto: CreateWagerTransactionDto) =>
      dto.kind === WagerTransactionKind.Refund ||
      dto.kind === WagerTransactionKind.Rollback,
  )
  @IsString()
  @Length(1, 160)
  referenceExternalTransactionId?: string;
}
