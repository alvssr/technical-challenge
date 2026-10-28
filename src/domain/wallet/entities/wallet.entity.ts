import { InsufficientBalanceError } from '../../errors/insufficient-balance.error.js';
import { Money } from '../../shared/value-objects/money.vo.js';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  createdAt?: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new Error('O saldo inicial da carteira não pode ser negativo.');
    }

    const now = props.createdAt ?? new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    if (!Number.isInteger(state.version) || state.version < 1) {
      throw new Error('A versão persistida da carteira deve ser positiva.');
    }
    if (state.balance.isNegative()) {
      throw new Error('O saldo persistido da carteira não pode ser negativo.');
    }

    return new Wallet(
      state.id,
      state.playerId,
      state.balance.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  static create(props: {
    id: string;
    playerId: string;
    balance: Money;
    createdAt?: Date;
    updatedAt?: Date;
  }): Wallet {
    const wallet = Wallet.open({
      id: props.id,
      playerId: props.playerId,
      initialBalance: props.balance,
      createdAt: props.createdAt,
    });

    if (props.updatedAt) {
      wallet._updatedAt = props.updatedAt;
    }
    return wallet;
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  credit(amount: Money, at: Date = new Date()): void {
    this.assertNonNegativeAmount(amount);
    if (amount.isZero()) return;

    this._balance = this._balance.add(amount);
    this.markAsUpdated(at);
  }

  debit(amount: Money, at: Date = new Date()): void {
    this.assertNonNegativeAmount(amount);
    if (amount.isZero()) return;

    if (this._balance.isLessThan(amount)) {
      throw new InsufficientBalanceError(
        `Saldo insuficiente para debitar ${amount.toString()} ${amount.currency}.`,
      );
    }

    this._balance = this._balance.subtract(amount);
    this.markAsUpdated(at);
  }

  private assertNonNegativeAmount(amount: Money): void {
    if (amount.isNegative()) {
      throw new Error('O valor da operação não pode ser negativo.');
    }
  }

  private markAsUpdated(at: Date): void {
    this._version += 1;
    this._updatedAt = at;
  }
}
