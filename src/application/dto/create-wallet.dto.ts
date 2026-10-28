import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { MoneyDto } from './money.dto.js';

export class CreateWalletDto {
  @IsUUID('all')
  playerId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
