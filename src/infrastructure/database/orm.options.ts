import { defineConfig } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { InboxMessageSchema } from './schemas/inbox-message.schema.js';
import { OutboxMessageSchema } from './schemas/outbox-message.schema.js';
import { WagerTransactionSchema } from './schemas/wager-transaction.schema.js';
import { WalletLedgerEntrySchema } from './schemas/wallet-ledger-entry.schema.js';
import { WalletSchema } from './schemas/wallet.schema.js';

export const ormOptions = defineConfig({
  entities: [
    WalletSchema,
    WagerTransactionSchema,
    WalletLedgerEntrySchema,
    InboxMessageSchema,
    OutboxMessageSchema,
  ],
  dbName: process.env.DB_NAME || 'wagering_db',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'wagering_user',
  password: process.env.DB_PASSWORD || 'wagering_pass',
  metadataProvider: TsMorphMetadataProvider,
  migrations: {
    path: './dist/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
    transactional: true,
  },
});
