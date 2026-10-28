import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from './money.dto.js';

export class CreateWalletDto {
  @ApiProperty({
    format: 'uuid',
    example: 'a12b3456-7890-4abc-8def-1234567890ab',
  })
  @IsUUID('all')
  playerId!: string;

  @ApiProperty({
    type: () => MoneyDto,
    description: 'Saldo inicial e moeda da carteira.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
