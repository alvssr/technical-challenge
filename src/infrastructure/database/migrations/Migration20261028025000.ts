import { Migration } from '@mikro-orm/migrations';

export class Migration20261028025000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create unique index "wager_transactions_provider_external_unique"
      on "wager_transactions" ("provider_id", "external_transaction_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "wager_transactions_provider_external_unique";',
    );
  }
}
