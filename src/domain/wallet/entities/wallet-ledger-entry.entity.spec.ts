import { describe, expect, it } from 'bun:test';
import { Money } from '../../shared/value-objects/money.vo.js';
import { LedgerDirection } from '../../transaction/enums/ledger-direction.enum.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.entity.js';

describe('WalletLedgerEntry Entity', () => {
  it('deve criar um lançamento válido no Ledger com saldos de auditoria', () => {
    const before = Money.from({ amount: '100.00', currency: 'BRL' });
    const amount = Money.from({ amount: '25.00', currency: 'BRL' });
    const after = Money.from({ amount: '75.00', currency: 'BRL' });
    const entry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      amount,
      balanceBefore: before,
      balanceAfter: after,
    });

    expect(entry.id).toBe('ledger-1');
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.amount.toString()).toBe('25.00');
    expect(entry.balanceAfter.toString()).toBe('75.00');
  });

  it('deve rejeitar lançamentos com valor zerado ou negativo', () => {
    const balance = Money.from({ amount: '100.00', currency: 'BRL' });
    const zeroAmount = Money.zero('BRL');

    expect(() => {
      WalletLedgerEntry.create({
        id: 'ledger-2',
        walletId: 'wallet-1',
        transactionId: 'tx-2',
        direction: LedgerDirection.Credit,
        amount: zeroAmount,
        balanceBefore: balance,
        balanceAfter: balance,
      });
    }).toThrow();
  });

  it('deve rejeitar um lançamento cujo saldo final não corresponde à operação', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-3',
        walletId: 'wallet-1',
        transactionId: 'tx-3',
        direction: LedgerDirection.Credit,
        amount: Money.from({ amount: '25.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '120.00', currency: 'BRL' }),
      }),
    ).toThrow('não corresponde');
  });
});
