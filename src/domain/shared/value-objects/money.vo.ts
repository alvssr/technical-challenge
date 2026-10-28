import { Decimal } from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const MAX_AMOUNT = new Decimal('9999999999999999.99');

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    if (!value.isFinite() || value.isNaN()) {
      throw new Error('O valor monetário não pode ser NaN ou Infinito.');
    }
    if (value.abs().greaterThan(MAX_AMOUNT)) {
      throw new Error('O valor monetário excede a precisão Decimal(18, 2).');
    }
  }

  static from(props: MoneyProps): Money {
    if (!/^[a-zA-Z]{3}$/.test(props.currency)) {
      throw new Error(
        'Moeda inválida. Deve seguir o padrão ISO-4217 de 3 letras (ex: BRL).',
      );
    }

    const currency = props.currency.toUpperCase();
    if (typeof props.amount !== 'string') {
      throw new Error('Amount deve ser uma string decimal válida.');
    }

    const rawAmount = props.amount.trim();

    if (!/^-?\d+(?:\.\d{1,2})?$/.test(rawAmount)) {
      throw new Error('Amount deve ser uma string decimal válida.');
    }

    let decimalValue: Decimal;
    try {
      decimalValue = new Decimal(rawAmount);
    } catch {
      throw new Error(`String monetária inválida: "${rawAmount}"`);
    }

    return new Money(decimalValue, currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    if (this.currency !== other.currency) return false;
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Conflito de moedas: Impossível realizar operação entre ${this.currency} e ${other.currency}.`,
      );
    }
  }
}
