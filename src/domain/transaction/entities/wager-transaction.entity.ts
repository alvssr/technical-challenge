import { InvalidTransactionStateError } from '../../errors/invalid-transaction-state.error.js';
import { Money } from '../../shared/value-objects/money.vo.js';
import { FailureCode } from '../enums/failure-code.enum.js';
import { LedgerDirection } from '../enums/ledger-direction.enum.js';
import { WagerTransactionKind } from '../enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../enums/wager-transaction-status.enum.js';

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  createdAt: Date;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new Error('O valor da transação deve ser maior que zero.');
    }

    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      !props.referenceExternalTransactionId
    ) {
      throw new Error(
        `A operação ${props.kind} exige a especificação do 'referenceExternalTransactionId'.`,
      );
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(props: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      props.status,
      props.referenceTransactionId,
      props.failureCode,
      props.processedAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date = new Date(),
  ): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  markPendingReference(): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    if (this.kind === WagerTransactionKind.Loss) return false;
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Pending
    );
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  ledgerDirectionFor(
    reference?: WagerTransaction,
  ): LedgerDirection | undefined {
    if (this.kind === WagerTransactionKind.Bet) return LedgerDirection.Debit;
    if (
      this.kind === WagerTransactionKind.Win ||
      this.kind === WagerTransactionKind.Opening
    ) {
      return LedgerDirection.Credit;
    }
    if (this.kind === WagerTransactionKind.Refund) return LedgerDirection.Credit;

    if (this.kind === WagerTransactionKind.Rollback && reference) {
      const referenceDirection = reference.ledgerDirectionFor();
      if (referenceDirection === LedgerDirection.Debit) {
        return LedgerDirection.Credit;
      }
      if (referenceDirection === LedgerDirection.Credit) {
        return LedgerDirection.Debit;
      }
    }

    return undefined;
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Transação ${this.id} já está em estado terminal (${this._status}) e não pode alterar de estado.`,
      );
    }
  }
}