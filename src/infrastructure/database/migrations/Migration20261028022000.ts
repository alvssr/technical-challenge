import { Migration } from '@mikro-orm/migrations';

export class Migration20261028022000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" add column "response_balance" numeric(18, 2) null;',
    );
    this.addSql(
      'alter table "wager_transactions" add constraint "wager_transactions_wallet_fk" foreign key ("wallet_id") references "wallets" ("id") on update cascade on delete restrict;',
    );
    this.addSql(
      'alter table "wager_transactions" add constraint "wager_transactions_reference_fk" foreign key ("reference_transaction_id") references "wager_transactions" ("id") on update cascade on delete restrict;',
    );
    this.addSql(
      'alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_fk" foreign key ("wallet_id") references "wallets" ("id") on update cascade on delete restrict;',
    );
    this.addSql(
      'alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_fk" foreign key ("transaction_id") references "wager_transactions" ("id") on update cascade on delete restrict;',
    );
    this.addSql(`
      create unique index "wager_transactions_reference_kind_unique"
      on "wager_transactions" ("provider_id", "reference_external_transaction_id", "kind")
      where "kind" in ('REFUND', 'ROLLBACK') and "reference_external_transaction_id" is not null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "wager_transactions_reference_kind_unique";',
    );
    this.addSql(
      'alter table "wallet_ledger_entries" drop constraint if exists "wallet_ledger_entries_transaction_fk";',
    );
    this.addSql(
      'alter table "wallet_ledger_entries" drop constraint if exists "wallet_ledger_entries_wallet_fk";',
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint if exists "wager_transactions_reference_fk";',
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint if exists "wager_transactions_wallet_fk";',
    );
    this.addSql(
      'alter table "wager_transactions" drop column if exists "response_balance";',
    );
  }
}
