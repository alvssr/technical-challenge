import { EntitySchema } from '@mikro-orm/core';
import { LedgerDirection } from '../../../domain/transaction/enums/ledger-direction.enum.js';

export interface WalletLedgerEntryPersistenceState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: Date;
}

export const WalletLedgerEntrySchema =
  new EntitySchema<WalletLedgerEntryPersistenceState>({
    name: 'WalletLedgerEntry',
    tableName: 'wallet_ledger_entries',
    properties: {
      id: { type: 'uuid', primary: true },
      walletId: { type: 'uuid', fieldName: 'wallet_id' },
      transactionId: { type: 'uuid', fieldName: 'transaction_id' },
      direction: {
        type: 'string',
        length: 16,
      },
      amount: {
        type: 'decimal',
        precision: 18,
        scale: 2,
        columnType: 'numeric(18, 2)',
      },
      currency: { type: 'string', length: 3 },
      balanceBefore: {
        type: 'decimal',
        precision: 18,
        scale: 2,
        fieldName: 'balance_before',
        columnType: 'numeric(18, 2)',
      },
      balanceAfter: {
        type: 'decimal',
        precision: 18,
        scale: 2,
        fieldName: 'balance_after',
        columnType: 'numeric(18, 2)',
      },
      createdAt: {
        type: 'timestamptz',
        fieldName: 'created_at',
        defaultRaw: 'now()',
      },
    },
    indexes: [
      { name: 'wallet_ledger_entries_wallet_idx', properties: ['walletId'] },
    ],
    uniques: [
      {
        name: 'wallet_ledger_entries_transaction_unique',
        properties: ['transactionId'],
      },
    ],
    checks: [
      {
        name: 'wallet_ledger_entries_amount_positive',
        expression: 'amount > 0',
      },
      {
        name: 'wallet_ledger_entries_balance_non_negative',
        expression: 'balance_before >= 0 and balance_after >= 0',
      },
      {
        name: 'wallet_ledger_entries_direction_check',
        expression: "direction in ('DEBIT', 'CREDIT')",
      },
      {
        name: 'wallet_ledger_entries_balance_consistency',
        expression:
          "(direction = 'CREDIT' and balance_after = balance_before + amount) or (direction = 'DEBIT' and balance_after = balance_before - amount)",
      },
    ],
  });
