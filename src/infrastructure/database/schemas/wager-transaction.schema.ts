import { EntitySchema } from '@mikro-orm/core';
import { FailureCode } from '../../../domain/transaction/enums/failure-code.enum.js';
import { WagerTransactionKind } from '../../../domain/transaction/enums/wager-transaction-kind.enum.js';
import { WagerTransactionStatus } from '../../../domain/transaction/enums/wager-transaction-status.enum.js';

export interface WagerTransactionPersistenceState {
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
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | null;
  failureCode: FailureCode | null;
  processedAt: Date | null;
  responseBalance: string | null;
  referenceAttempts: number;
  referenceNextAttemptAt: Date | null;
}

export const WagerTransactionSchema =
  new EntitySchema<WagerTransactionPersistenceState>({
    name: 'WagerTransaction',
    tableName: 'wager_transactions',
    properties: {
      id: { type: 'uuid', primary: true },
      providerId: { type: 'string', fieldName: 'provider_id' },
      externalTransactionId: {
        type: 'string',
        fieldName: 'external_transaction_id',
      },
      idempotencyKey: {
        type: 'string',
        fieldName: 'idempotency_key',
        unique: true,
      },
      payloadHash: { type: 'string', fieldName: 'payload_hash' },
      walletId: { type: 'uuid', fieldName: 'wallet_id' },
      playerId: { type: 'string', fieldName: 'player_id' },
      roundId: { type: 'string', fieldName: 'round_id' },
      gameId: { type: 'string', fieldName: 'game_id' },
      kind: { type: 'string', length: 32 },
      amount: {
        type: 'decimal',
        precision: 18,
        scale: 2,
        columnType: 'numeric(18, 2)',
      },
      currency: { type: 'string', length: 3 },
      referenceExternalTransactionId: {
        type: 'string',
        fieldName: 'reference_external_transaction_id',
        nullable: true,
      },
      createdAt: {
        type: 'timestamptz',
        fieldName: 'created_at',
        defaultRaw: 'now()',
      },
      status: { type: 'string', length: 32 },
      referenceTransactionId: {
        type: 'uuid',
        fieldName: 'reference_transaction_id',
        nullable: true,
      },
      failureCode: {
        type: 'string',
        length: 64,
        fieldName: 'failure_code',
        nullable: true,
      },
      processedAt: {
        type: 'timestamptz',
        fieldName: 'processed_at',
        nullable: true,
      },
      responseBalance: {
        type: 'decimal',
        precision: 18,
        scale: 2,
        columnType: 'numeric(18, 2)',
        fieldName: 'response_balance',
        nullable: true,
      },
      referenceAttempts: {
        type: 'number',
        fieldName: 'reference_attempts',
        default: 0,
      },
      referenceNextAttemptAt: {
        type: 'timestamptz',
        fieldName: 'reference_next_attempt_at',
        nullable: true,
      },
    },
    indexes: [
      { name: 'wager_transactions_wallet_idx', properties: ['walletId'] },
      { name: 'wager_transactions_round_idx', properties: ['roundId'] },
      {
        name: 'wager_transactions_pending_reference_due_idx',
        properties: ['referenceNextAttemptAt', 'createdAt'],
        where: "status = 'PENDING_REFERENCE'",
      },
    ],
    uniques: [
      {
        name: 'wager_transactions_provider_external_unique',
        properties: ['providerId', 'externalTransactionId'],
      },
      {
        name: 'wager_transactions_processed_reversal_unique',
        properties: ['providerId', 'referenceExternalTransactionId'],
        where:
          "kind in ('REFUND', 'ROLLBACK') and status = 'PROCESSED' and reference_external_transaction_id is not null",
      },
    ],
    checks: [
      {
        name: 'wager_transactions_amount_positive',
        expression: 'amount > 0',
      },
      {
        name: 'wager_transactions_kind_check',
        expression:
          "kind in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')",
      },
      {
        name: 'wager_transactions_status_check',
        expression:
          "status in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')",
      },
      {
        name: 'wager_transactions_reference_attempts_non_negative',
        expression: 'reference_attempts >= 0',
      },
      {
        name: 'wager_transactions_failure_code_check',
        expression: `failure_code in (${Object.values(FailureCode)
          .map((code) => `'${code}'`)
          .join(', ')})`,
      },
    ],
  });
