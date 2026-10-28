import { EntitySchema } from '@mikro-orm/core';

export interface WalletPersistenceState {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const WalletSchema = new EntitySchema<WalletPersistenceState>({
  name: 'Wallet',
  tableName: 'wallets',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'string', fieldName: 'player_id' },
    currency: { type: 'string', length: 3 },
    balance: {
      type: 'decimal',
      precision: 18,
      scale: 2,
      columnType: 'numeric(18, 2)',
    },
    version: { type: 'number', version: true, default: 1 },
    createdAt: {
      type: 'timestamptz',
      fieldName: 'created_at',
      defaultRaw: 'now()',
    },
    updatedAt: {
      type: 'timestamptz',
      fieldName: 'updated_at',
      defaultRaw: 'now()',
      onUpdate: () => new Date(),
    },
  },
  uniques: [
    {
      name: 'wallets_player_currency_unique',
      properties: ['playerId', 'currency'],
    },
  ],
  checks: [
    {
      name: 'wallets_balance_non_negative',
      expression: 'balance >= 0',
    },
    {
      name: 'wallets_currency_format',
      expression: "currency ~ '^[A-Z]{3}$'",
    },
    {
      name: 'wallets_version_positive',
      expression: 'version >= 1',
    },
  ],
});
