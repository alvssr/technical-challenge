import { Matches } from 'class-validator';

export class MoneyDto {
  @Matches(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/, {
    message: 'amount deve ser uma string decimal positiva, com até 2 casas.',
  })
  amount!: string;

  @Matches(/^[A-Z]{3}$/, {
    message: 'currency deve ser um código ISO de três letras maiúsculas.',
  })
  currency!: string;
}
