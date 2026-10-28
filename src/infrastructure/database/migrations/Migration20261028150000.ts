import { Migration } from '@mikro-orm/migrations';

export class Migration20261028150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
        add column "reference_attempts" integer not null default 0,
        add column "reference_next_attempt_at" timestamptz null,
        add constraint "wager_transactions_reference_attempts_non_negative"
          check ("reference_attempts" >= 0);
    `);
    this.addSql(`
      create index "wager_transactions_pending_reference_due_idx"
      on "wager_transactions" ("reference_next_attempt_at", "created_at")
      where "status" = 'PENDING_REFERENCE';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "wager_transactions_pending_reference_due_idx";',
    );
    this.addSql(`
      alter table "wager_transactions"
        drop constraint if exists "wager_transactions_reference_attempts_non_negative",
        drop column if exists "reference_next_attempt_at",
        drop column if exists "reference_attempts";
    `);
  }
}
