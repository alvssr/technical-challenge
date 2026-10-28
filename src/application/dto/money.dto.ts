import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoneyDto {
  @ApiProperty({
    example: '25.00',
    description: 'Valor decimal como string, com até duas casas decimais.',
    pattern: '^(0|[1-9]\\d{0,15})(\\.\\d{1,2})?$',
  })
  @Matches(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/, {
    message: 'amount deve ser uma string decimal positiva, com até 2 casas.',
  })
  amount!: string;

  @ApiProperty({
    example: 'BRL',
    description: 'Código de moeda com três letras maiúsculas.',
    pattern: '^[A-Z]{3}$',
  })
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency deve ser um código ISO de três letras maiúsculas.',
  })
  currency!: string;
}
