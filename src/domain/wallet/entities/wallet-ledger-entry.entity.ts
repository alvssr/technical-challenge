import { Money } from '../../shared/value-objects/money.vo.js';
import { LedgerDirection } from '../../transaction/enums/ledger-direction.enum.js';

export interface CreateWalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

export interface WalletLedgerEntryState extends CreateWalletLedgerEntryProps {
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly amount: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateWalletLedgerEntryProps): WalletLedgerEntry {
    WalletLedgerEntry.assertValid(props);

    return new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.amount,
      props.balanceBefore,
      props.balanceAfter,
      new Date(),
    );
  }

  static rehydrate(state: WalletLedgerEntryState): WalletLedgerEntry {
    WalletLedgerEntry.assertValid(state);

    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.amount,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  private static assertValid(props: CreateWalletLedgerEntryProps): void {
    if (!props.amount.isPositive()) {
      throw new Error(
        'O valor do lançamento no Ledger deve ser estritamente positivo.',
      );
    }

    const expectedBalance =
      props.direction === LedgerDirection.Credit
        ? props.balanceBefore.add(props.amount)
        : props.balanceBefore.subtract(props.amount);

    if (
      expectedBalance.isNegative() ||
      !expectedBalance.equals(props.balanceAfter)
    ) {
      throw new Error(
        'O saldo final do lançamento não corresponde à direção e ao valor registrados.',
      );
    }
  }
}
