import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { createHash, randomUUID } from 'node:crypto';
import { Money } from '../domain/shared/value-objects/money.vo.js';
import { FailureCode } from '../domain/transaction/enums/failure-code.enum.js';
import { LedgerDirection } from '../domain/transaction/enums/ledger-direction.enum.js';
import { WagerTransactionKind } from '../domain/transaction/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../domain/transaction/enums/wager-transaction-status.enum.js';
import { WagerTransaction } from '../domain/transaction/entities/wager-transaction.entity.js';
import { InsufficientBalanceError } from '../domain/errors/insufficient-balance.error.js';
import { Wallet } from '../domain/wallet/entities/wallet.entity.js';
import { WalletLedgerEntry } from '../domain/wallet/entities/wallet-ledger-entry.entity.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { CreateWagerTransactionDto } from './dto/create-wager-transaction.dto.js';
import { DATABASE_ORM } from '../infrastructure/database/database.module.js';
import {
  WalletPersistenceState,
  WalletSchema,
} from '../infrastructure/database/schemas/wallet.schema.js';
import {
  WagerTransactionPersistenceState,
  WagerTransactionSchema,
} from '../infrastructure/database/schemas/wager-transaction.schema.js';
import {
  WalletLedgerEntryPersistenceState,
  WalletLedgerEntrySchema,
} from '../infrastructure/database/schemas/wallet-ledger-entry.schema.js';
import { OutboxMessageSchema } from '../infrastructure/database/schemas/outbox-message.schema.js';
import { Inject } from '@nestjs/common';

@Injectable()
export class FinancialService {
  constructor(@Inject(DATABASE_ORM) private readonly orm: MikroORM) {}

  async openWallet(dto: CreateWalletDto): Promise<Record<string, unknown>> {
    const balance = Money.from(dto.initialBalance);
    const wallet = Wallet.open({
      id: randomUUID(),
      playerId: dto.playerId,
      initialBalance: balance,
    });

    try {
      return await this.orm.em.fork().transactional(async (em) => {
        await em.insert(WalletSchema, {
          id: wallet.id,
          playerId: wallet.playerId,
          currency: wallet.currency,
          balance: wallet.balance.toString(),
          version: wallet.version,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        });

        if (balance.isPositive()) {
          const openingId = randomUUID();
          const opening = WagerTransaction.create({
            id: openingId,
            providerId: 'internal',
            externalTransactionId: `opening:${wallet.id}`,
            idempotencyKey: `opening:${wallet.id}`,
            payloadHash: hashPayload({
              walletId: wallet.id,
              amount: balance.toString(),
              currency: balance.currency,
            }),
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: 'opening',
            gameId: 'internal',
            kind: WagerTransactionKind.Opening,
            money: balance,
          });
          opening.markProcessed(undefined);

          await this.insertTransaction(em, opening, wallet.balance.toString());
          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: opening.id,
            direction: LedgerDirection.Credit,
            amount: balance,
            balanceBefore: Money.zero(balance.currency),
            balanceAfter: balance,
          });
          await this.insertLedgerEntry(em, ledgerEntry);
          await this.enqueueOutbox(em, 'WagerTransactionProcessed', wallet.id, {
            transactionId: opening.id,
            walletId: wallet.id,
            kind: WagerTransactionKind.Opening,
          });
          await this.enqueueOutbox(em, 'WalletBalanceChanged', wallet.id, {
            transactionId: opening.id,
            walletId: wallet.id,
            direction: LedgerDirection.Credit,
            money: balance.toJSON(),
            balanceBefore: Money.zero(balance.currency).toJSON(),
            balanceAfter: balance.toJSON(),
            walletVersion: wallet.version,
          });
        }

        return walletResponse(wallet);
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Já existe uma carteira para este jogador e moeda.',
        );
      }
      throw error;
    }
  }

  async processTransaction(
    dto: CreateWagerTransactionDto,
    idempotencyKeyHeader: string | string[] | undefined,
  ): Promise<FinancialTransactionResponse> {
    if (
      typeof idempotencyKeyHeader !== 'string' ||
      idempotencyKeyHeader.trim().length === 0 ||
      idempotencyKeyHeader.length > 255
    ) {
      throw new BadRequestException(
        'O header Idempotency-Key é obrigatório e deve ter até 255 caracteres.',
      );
    }
    const idempotencyKey = idempotencyKeyHeader.trim();

    const money = Money.from(dto.money);
    const payloadHash = hashPayload({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: money.toJSON(),
      referenceExternalTransactionId:
        dto.referenceExternalTransactionId ?? null,
    });

    try {
      return await this.orm.em.fork().transactional(async (em) => {
        const replayBeforeLock = await this.findByIdempotencyKey(
          em,
          idempotencyKey,
        );
        if (replayBeforeLock) {
          return replayResponse(replayBeforeLock, payloadHash);
        }

        const walletState = await em.findOne<WalletPersistenceState>(
          WalletSchema,
          { id: dto.walletId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!walletState) {
          throw new NotFoundException('Carteira não encontrada.');
        }

        const replayAfterLock = await this.findByIdempotencyKey(
          em,
          idempotencyKey,
        );
        if (replayAfterLock) {
          return replayResponse(replayAfterLock, payloadHash);
        }

        const wallet = Wallet.rehydrate({
          id: walletState.id,
          playerId: walletState.playerId,
          balance: Money.from({
            amount: walletState.balance,
            currency: walletState.currency,
          }),
          version: walletState.version,
          createdAt: walletState.createdAt,
          updatedAt: walletState.updatedAt,
        });

        const transaction = WagerTransaction.create({
          id: randomUUID(),
          providerId: dto.providerId,
          externalTransactionId: dto.externalTransactionId,
          idempotencyKey,
          payloadHash,
          walletId: dto.walletId,
          playerId: dto.playerId,
          roundId: dto.roundId,
          gameId: dto.gameId,
          kind: dto.kind,
          money,
          referenceExternalTransactionId:
            dto.referenceExternalTransactionId,
        });

        const rejection = this.getWalletRejection(dto, money, wallet);
        if (rejection) {
          return this.rejectTransaction(
            em,
            transaction,
            wallet,
            rejection,
          );
        }

        let reference: WagerTransactionPersistenceState | null = null;
        if (transaction.requiresReference()) {
          reference = await this.findReference(em, transaction);
          if (!reference) {
            transaction.markPendingReference();
            await this.insertTransaction(
              em,
              transaction,
              wallet.balance.toString(),
            );
            await this.enqueueOutbox(
              em,
              'WagerTransactionPendingReference',
              wallet.id,
              {
                transactionId: transaction.id,
                walletId: wallet.id,
                providerId: transaction.providerId,
                referenceExternalTransactionId:
                  transaction.referenceExternalTransactionId,
              },
            );
            return transactionResponse(
              transaction.id,
              transaction.status,
              wallet.balance,
              false,
            );
          }

          const invalidReferenceCode = await this.validateReference(
            em,
            transaction,
            reference,
          );
          if (invalidReferenceCode) {
            return this.rejectTransaction(
              em,
              transaction,
              wallet,
              invalidReferenceCode,
            );
          }
        }

        if (
          reference &&
          (transaction.kind === WagerTransactionKind.Refund ||
            transaction.kind === WagerTransactionKind.Rollback)
        ) {
          const duplicateReversal = await em.findOne<WagerTransactionPersistenceState>(
            WagerTransactionSchema,
            {
              providerId: transaction.providerId,
              referenceExternalTransactionId:
                transaction.referenceExternalTransactionId,
              kind: transaction.kind,
            },
          );
          if (duplicateReversal) {
            return this.rejectTransaction(
              em,
              transaction,
              wallet,
              FailureCode.DuplicateTransaction,
            );
          }
        }

        const balanceBefore = wallet.balance;
        const direction = transaction.ledgerDirectionFor(
          reference
            ? transactionFromPersistence(reference)
            : undefined,
        );

        try {
          if (direction === LedgerDirection.Debit) {
            wallet.debit(money);
          } else if (direction === LedgerDirection.Credit) {
            wallet.credit(money);
          }
        } catch (error: unknown) {
          if (!(error instanceof InsufficientBalanceError)) {
            throw error;
          }
          const failureCode =
            transaction.kind === WagerTransactionKind.Rollback
              ? FailureCode.ReversalWouldCauseNegativeBalance
              : FailureCode.InsufficientFunds;
          return this.rejectTransaction(em, transaction, wallet, failureCode);
        }

        transaction.markProcessed(reference?.id);
        if (!balanceBefore.equals(wallet.balance)) {
          await em.nativeUpdate(
            WalletSchema,
            { id: wallet.id },
            {
              balance: wallet.balance.toString(),
              version: wallet.version,
              updatedAt: wallet.updatedAt,
            },
          );
        }

        await this.insertTransaction(
          em,
          transaction,
          wallet.balance.toString(),
        );

        if (direction && !balanceBefore.equals(wallet.balance)) {
          const entry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction,
            amount: money,
            balanceBefore,
            balanceAfter: wallet.balance,
          });
          await this.insertLedgerEntry(em, entry);
          await this.enqueueOutbox(em, 'WalletBalanceChanged', wallet.id, {
            transactionId: transaction.id,
            walletId: wallet.id,
            direction,
            money: money.toJSON(),
            balanceBefore: balanceBefore.toJSON(),
            balanceAfter: wallet.balance.toJSON(),
            walletVersion: wallet.version,
          });
        }

        await this.enqueueOutbox(
          em,
          'WagerTransactionProcessed',
          wallet.id,
          {
            transactionId: transaction.id,
            walletId: wallet.id,
            kind: transaction.kind,
            status: transaction.status,
          },
        );
        return transactionResponse(
          transaction.id,
          transaction.status,
          wallet.balance,
          false,
        );
      });
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;

      const persisted = await this.findByIdempotencyKey(
        this.orm.em.fork(),
        idempotencyKey,
      );
      if (!persisted) {
        throw new ConflictException(
          'A operação conflita com uma transação financeira existente.',
        );
      }
      return replayResponse(persisted, payloadHash);
    }
  }

  async reconcile(walletId: string): Promise<Record<string, unknown>> {
    const em = this.orm.em.fork();
    const walletState = await em.findOne<WalletPersistenceState>(WalletSchema, {
      id: walletId,
    });
    if (!walletState) throw new NotFoundException('Carteira não encontrada.');

    const storedBalance = Money.from({
      amount: walletState.balance,
      currency: walletState.currency,
    });
    const entries = await em.find<WalletLedgerEntryPersistenceState>(
      WalletLedgerEntrySchema,
      { walletId },
      { orderBy: { createdAt: 'ASC' } },
    );
    let calculatedBalance = Money.zero(walletState.currency);
    for (const entry of entries) {
      const ledgerEntry = WalletLedgerEntry.rehydrate({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        amount: Money.from({
          amount: entry.amount,
          currency: entry.currency,
        }),
        balanceBefore: Money.from({
          amount: entry.balanceBefore,
          currency: entry.currency,
        }),
        balanceAfter: Money.from({
          amount: entry.balanceAfter,
          currency: entry.currency,
        }),
        createdAt: entry.createdAt,
      });
      calculatedBalance =
        ledgerEntry.direction === LedgerDirection.Credit
          ? calculatedBalance.add(ledgerEntry.amount)
          : calculatedBalance.subtract(ledgerEntry.amount);
    }

    return {
      walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: storedBalance.subtract(calculatedBalance).toJSON(),
      consistent: storedBalance.equals(calculatedBalance),
      checkedEntries: entries.length,
    };
  }

  private getWalletRejection(
    dto: CreateWagerTransactionDto,
    money: Money,
    wallet: Wallet,
  ): FailureCode | undefined {
    if (wallet.playerId !== dto.playerId) {
      return FailureCode.InvalidOperationKind;
    }
    if (wallet.currency !== money.currency) {
      return FailureCode.CurrencyMismatch;
    }
    return undefined;
  }

  private async findReference(
    em: EntityManager,
    transaction: WagerTransaction,
  ): Promise<WagerTransactionPersistenceState | null> {
    return em.findOne<WagerTransactionPersistenceState>(
      WagerTransactionSchema,
      {
        providerId: transaction.providerId,
        externalTransactionId: transaction.referenceExternalTransactionId,
      },
    );
  }

  private async validateReference(
    em: EntityManager,
    transaction: WagerTransaction,
    reference: WagerTransactionPersistenceState,
  ): Promise<FailureCode | undefined> {
    if (
      reference.status !== WagerTransactionStatus.Processed ||
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.roundId !== transaction.roundId ||
      reference.currency !== transaction.money.currency ||
      reference.amount !== transaction.money.toString()
    ) {
      return reference.currency !== transaction.money.currency
        ? FailureCode.CurrencyMismatch
        : FailureCode.InvalidReferenceState;
    }

    if (
      transaction.kind === WagerTransactionKind.Refund &&
      reference.kind !== WagerTransactionKind.Bet
    ) {
      return FailureCode.InvalidReferenceState;
    }

    if (
      transaction.kind === WagerTransactionKind.Rollback &&
      ![
        WagerTransactionKind.Bet,
        WagerTransactionKind.Win,
        WagerTransactionKind.Refund,
      ].includes(reference.kind)
    ) {
      return FailureCode.InvalidReferenceState;
    }

    const priorReversal = await em.findOne<WagerTransactionPersistenceState>(
      WagerTransactionSchema,
      {
        providerId: transaction.providerId,
        referenceExternalTransactionId: reference.externalTransactionId,
        kind: transaction.kind,
      },
    );
    return priorReversal ? FailureCode.DuplicateTransaction : undefined;
  }

  private async rejectTransaction(
    em: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    failureCode: FailureCode,
  ): Promise<FinancialTransactionResponse> {
    transaction.reject(failureCode);
    await this.insertTransaction(
      em,
      transaction,
      wallet.balance.toString(),
    );
    await this.enqueueOutbox(em, 'WagerTransactionRejected', wallet.id, {
      transactionId: transaction.id,
      walletId: wallet.id,
      failureCode,
    });
    return {
      ...transactionResponse(
        transaction.id,
        transaction.status,
        wallet.balance,
        false,
      ),
      failureCode,
    };
  }

  private async findByIdempotencyKey(
    em: EntityManager,
    idempotencyKey: string,
  ): Promise<WagerTransactionPersistenceState | null> {
    return em.findOne<WagerTransactionPersistenceState>(
      WagerTransactionSchema,
      { idempotencyKey },
    );
  }

  private async insertTransaction(
    em: EntityManager,
    transaction: WagerTransaction,
    responseBalance: string,
  ): Promise<void> {
    await em.insert(WagerTransactionSchema, {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      amount: transaction.money.toString(),
      currency: transaction.money.currency,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId ?? null,
      createdAt: transaction.createdAt,
      status: transaction.status,
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      failureCode: transaction.failureCode ?? null,
      processedAt: transaction.processedAt ?? null,
      responseBalance,
    });
  }

  private async insertLedgerEntry(
    em: EntityManager,
    entry: WalletLedgerEntry,
  ): Promise<void> {
    await em.insert(WalletLedgerEntrySchema, {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.amount.toString(),
      currency: entry.amount.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      createdAt: entry.createdAt,
    });
  }

  private async enqueueOutbox(
    em: EntityManager,
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await em.insert(OutboxMessageSchema, {
      id: randomUUID(),
      aggregateId,
      eventType,
      payload,
      occurredAt: new Date(),
      attempts: 0,
      nextAttemptAt: null,
      publishedAt: null,
    });
  }
}

export interface FinancialTransactionResponse {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: ReturnType<Money['toJSON']>;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

export function transactionHttpStatus(
  status: WagerTransactionStatus,
): number {
  if (status === WagerTransactionStatus.PendingReference) return 202;
  if (status === WagerTransactionStatus.Rejected) return 422;
  return 200;
}

function walletResponse(wallet: Wallet): Record<string, unknown> {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

function transactionResponse(
  transactionId: string,
  status: WagerTransactionStatus,
  balance: Money,
  idempotentReplay: boolean,
): FinancialTransactionResponse {
  return {
    transactionId,
    status,
    balance: balance.toJSON(),
    idempotentReplay,
  };
}

function replayResponse(
  transaction: WagerTransactionPersistenceState,
  receivedPayloadHash: string,
): FinancialTransactionResponse {
  if (transaction.payloadHash !== receivedPayloadHash) {
    throw new ConflictException(
      'A chave de idempotência já foi usada com outro payload.',
    );
  }
  if (!transaction.responseBalance) {
    throw new Error(
      'Transação idempotente persistida sem snapshot de resposta.',
    );
  }

  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: {
      amount: Money.from({
        amount: transaction.responseBalance,
        currency: transaction.currency,
      }).toString(),
      currency: transaction.currency,
    },
    idempotentReplay: true,
    ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
  };
}

function transactionFromPersistence(
  state: WagerTransactionPersistenceState,
): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: state.id,
    providerId: state.providerId,
    externalTransactionId: state.externalTransactionId,
    idempotencyKey: state.idempotencyKey,
    payloadHash: state.payloadHash,
    walletId: state.walletId,
    playerId: state.playerId,
    roundId: state.roundId,
    gameId: state.gameId,
    kind: state.kind,
    money: Money.from({ amount: state.amount, currency: state.currency }),
    referenceExternalTransactionId:
      state.referenceExternalTransactionId ?? undefined,
    status: state.status,
    createdAt: state.createdAt,
    referenceTransactionId: state.referenceTransactionId ?? undefined,
    failureCode: state.failureCode ?? undefined,
    processedAt: state.processedAt ?? undefined,
  });
}

function hashPayload(payload: Record<string, unknown>): string {
  const canonicalJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(payload).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
  return createHash('sha256').update(canonicalJson).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  if ('cause' in error) return isUniqueViolation(error.cause);
  return false;
}
