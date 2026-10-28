import { describe, expect, it } from 'bun:test';
import { InvalidTransactionStateError } from '../../errors/invalid-transaction-state.error.js';
import { Money } from '../../shared/value-objects/money.vo.js';
import { FailureCode } from '../enums/failure-code.enum.js';
import { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../enums/wager-transaction-status.enum.js';
import { WagerTransaction } from './wager-transaction.entity.js';

describe('WagerTransaction Entity', () => {
  const baseProps = {
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-tx-1',
    idempotencyKey: 'provider-a:ext-tx-1',
    payloadHash: 'hash-123',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
  };

  it('deve criar uma transação no estado PENDING', () => {
    const tx = WagerTransaction.create(baseProps);

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
  });

  it('deve exigir referência ao criar REFUND ou ROLLBACK', () => {
    expect(() => {
      WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
      });
    }).toThrow();

    const validRefund = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ext-bet-1',
    });

    expect(validRefund.requiresReference()).toBe(true);
  });

  it('deve marcar como PROCESSED e proibir alterações futuras por ser estado terminal', () => {
    const tx = WagerTransaction.create(baseProps);
    tx.markProcessed(undefined);

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(
      InvalidTransactionStateError,
    );
  });

  it('não deve considerar LOSS ou REJECTED como eventos que alteram o saldo', () => {
    const loss = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Loss,
    });
    const rejected = WagerTransaction.create(baseProps);
    rejected.reject(FailureCode.InsufficientFunds);

    expect(loss.affectsBalance()).toBe(false);
    expect(rejected.affectsBalance()).toBe(false);
  });
});
