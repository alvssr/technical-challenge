import { Migration } from '@mikro-orm/migrations';

export class Migration20261028140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'drop index if exists "wager_transactions_reference_kind_unique";',
    );
    this.addSql(`
      create unique index "wager_transactions_processed_reversal_unique"
      on "wager_transactions" ("provider_id", "reference_external_transaction_id")
      where "kind" in ('REFUND', 'ROLLBACK')
        and "status" = 'PROCESSED'
        and "reference_external_transaction_id" is not null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "wager_transactions_processed_reversal_unique";',
    );
    this.addSql(`
      create unique index "wager_transactions_reference_kind_unique"
      on "wager_transactions" ("provider_id", "reference_external_transaction_id", "kind")
      where "kind" in ('REFUND', 'ROLLBACK')
        and "reference_external_transaction_id" is not null;
    `);
  }
}
