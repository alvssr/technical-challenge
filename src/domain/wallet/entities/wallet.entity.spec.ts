import { describe, expect, it } from 'bun:test';
import { InsufficientBalanceError } from '../../errors/insufficient-balance.error.js';
import { Money } from '../../shared/value-objects/money.vo.js';
import { Wallet } from './wallet.entity.js';

describe('Wallet Aggregate Root', () => {
  it('deve abrir uma carteira com saldo inicial e versão 1', () => {
    const initialBalance = Money.from({ amount: '100.00', currency: 'BRL' });
    const wallet = Wallet.open({
      id: 'wallet-123',
      playerId: 'player-456',
      initialBalance,
    });

    expect(wallet.id).toBe('wallet-123');
    expect(wallet.playerId).toBe('player-456');
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('deve realizar crédito com sucesso e incrementar a versão da carteira', () => {
    const wallet = Wallet.open({
      id: 'wallet-123',
      playerId: 'player-456',
      initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    wallet.credit(Money.from({ amount: '25.00', currency: 'BRL' }));

    expect(wallet.balance.toString()).toBe('75.00');
    expect(wallet.version).toBe(2);
  });

  it('deve realizar débito com sucesso quando houver saldo suficiente', () => {
    const wallet = Wallet.open({
      id: 'wallet-123',
      playerId: 'player-456',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    wallet.debit(Money.from({ amount: '40.00', currency: 'BRL' }));

    expect(wallet.balance.toString()).toBe('60.00');
    expect(wallet.version).toBe(2);
  });

  it('deve lançar InsufficientBalanceError ao tentar debitar valor maior que o saldo atual', () => {
    const wallet = Wallet.open({
      id: 'wallet-123',
      playerId: 'player-456',
      initialBalance: Money.from({ amount: '30.00', currency: 'BRL' }),
    });

    expect(() => {
      wallet.debit(Money.from({ amount: '50.00', currency: 'BRL' }));
    }).toThrow(InsufficientBalanceError);
    expect(wallet.balance.toString()).toBe('30.00');
    expect(wallet.version).toBe(1);
  });

  it('não incrementa a versão quando o saldo não muda', () => {
    const wallet = Wallet.open({
      id: 'wallet-123',
      playerId: 'player-456',
      initialBalance: Money.from({ amount: '30.00', currency: 'BRL' }),
    });

    wallet.credit(Money.zero('BRL'));
    wallet.debit(Money.zero('BRL'));

    expect(wallet.balance.toString()).toBe('30.00');
    expect(wallet.version).toBe(1);
  });

  it('rehydrate restaura o estado e sua versão', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const wallet = Wallet.rehydrate({
      id: 'wallet-123',
      playerId: 'player-456',
      balance: Money.from({ amount: '30.00', currency: 'BRL' }),
      version: 7,
      createdAt: updatedAt,
      updatedAt,
    });

    expect(wallet.version).toBe(7);
    expect(wallet.updatedAt).toBe(updatedAt);
  });
});
