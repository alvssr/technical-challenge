import { describe, expect, it } from 'bun:test';
import { Money } from './money.vo.js';

describe('Money Value Object', () => {
  it('deve criar uma instância válida de Money com 2 casas decimais', () => {
    const money = Money.from({ amount: '25.50', currency: 'BRL' });

    expect(money.toString()).toBe('25.50');
    expect(money.currency).toBe('BRL');
  });

  it('deve garantir a imutabilidade nas operações de adição', () => {
    const vinte = Money.from({ amount: '20.00', currency: 'BRL' });
    const dez = Money.from({ amount: '10.00', currency: 'BRL' });
    const resultado = vinte.add(dez);

    expect(resultado.toString()).toBe('30.00');
    expect(vinte.toString()).toBe('20.00');
  });

  it('deve lançar erro ao tentar realizar operações entre moedas diferentes', () => {
    const brl = Money.from({ amount: '100.00', currency: 'BRL' });
    const usd = Money.from({ amount: '50.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow('Conflito de moedas');
  });

  it('deve rejeitar entradas inválidas como mais de 2 casas decimais ou notação científica', () => {
    expect(() => Money.from({ amount: '10.555', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: '1e5', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: 'invalido', currency: 'BRL' })).toThrow();
  });

  it('deve rejeitar valores fora da precisão Decimal(18, 2)', () => {
    expect(() =>
      Money.from({ amount: '10000000000000000.00', currency: 'BRL' }),
    ).toThrow('excede a precisão Decimal(18, 2)');
  });

  it('deve rejeitar operações que ultrapassem a precisão Decimal(18, 2)', () => {
    const maxAmount = Money.from({
      amount: '9999999999999999.99',
      currency: 'BRL',
    });

    expect(() =>
      maxAmount.add(Money.from({ amount: '0.01', currency: 'BRL' })),
    ).toThrow('excede a precisão Decimal(18, 2)');
  });
});
