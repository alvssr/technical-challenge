import { Migration } from '@mikro-orm/migrations';

export class Migration20261028026000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('drop index if exists "wager_transactions_provider_external_idx";');
  }

  override async down(): Promise<void> {
    this.addSql(`
      create index if not exists "wager_transactions_provider_external_idx"
      on "wager_transactions" ("provider_id", "external_transaction_id");
    `);
  }
}
