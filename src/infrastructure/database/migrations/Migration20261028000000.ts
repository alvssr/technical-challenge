import { Migration } from '@mikro-orm/migrations';

export class Migration20261028000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" varchar(255) not null,
        "currency" varchar(3) not null,
        "balance" numeric(18, 2) not null,
        "version" integer not null default 1,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "wallets_pkey" primary key ("id"),
        constraint "wallets_balance_non_negative" check ("balance" >= 0),
        constraint "wallets_currency_format" check ("currency" ~ '^[A-Z]{3}$'),
        constraint "wallets_version_positive" check ("version" >= 1),
        constraint "wallets_player_currency_unique" unique ("player_id", "currency")
      );
    `);
    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar(255) not null,
        "external_transaction_id" varchar(255) not null,
        "idempotency_key" varchar(255) not null,
        "payload_hash" varchar(255) not null,
        "wallet_id" uuid not null,
        "player_id" varchar(255) not null,
        "round_id" varchar(255) not null,
        "game_id" varchar(255) not null,
        "kind" varchar(32) not null,
        "amount" numeric(18, 2) not null,
        "currency" varchar(3) not null,
        "reference_external_transaction_id" varchar(255) null,
        "created_at" timestamptz not null default now(),
        "status" varchar(32) not null,
        "reference_transaction_id" uuid null,
        "failure_code" varchar(64) null,
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_transactions_amount_positive" check ("amount" > 0),
        constraint "wager_transactions_kind_check"
          check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        constraint "wager_transactions_status_check"
          check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        constraint "wager_transactions_failure_code_check"
          check ("failure_code" in ('INSUFFICIENT_FUNDS', 'MISSING_REFERENCE', 'INVALID_REFERENCE_STATE', 'DUPLICATE_TRANSACTION', 'CURRENCY_MISMATCH', 'INVALID_OPERATION_KIND', 'PAYLOAD_MISMATCH', 'REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE'))
      );
    `);
    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(16) not null,
        "amount" numeric(18, 2) not null,
        "currency" varchar(3) not null,
        "balance_before" numeric(18, 2) not null,
        "balance_after" numeric(18, 2) not null,
        "created_at" timestamptz not null default now(),
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "wallet_ledger_entries_transaction_unique" unique ("transaction_id"),
        constraint "wallet_ledger_entries_amount_positive" check ("amount" > 0),
        constraint "wallet_ledger_entries_balance_non_negative"
          check ("balance_before" >= 0 and "balance_after" >= 0),
        constraint "wallet_ledger_entries_direction_check"
          check ("direction" in ('DEBIT', 'CREDIT')),
        constraint "wallet_ledger_entries_balance_consistency"
          check (
            ("direction" = 'CREDIT' and "balance_after" = "balance_before" + "amount")
            or ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount")
          )
      );
    `);
    this.addSql(`
      create table "inbox_messages" (
        "message_id" varchar(255) not null,
        "consumer_name" varchar(255) not null,
        "payload_hash" varchar(255) not null,
        "received_at" timestamptz not null default now(),
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("consumer_name", "message_id")
      );
    `);
    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" varchar(255) not null,
        "event_type" varchar(255) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null default now(),
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id"),
        constraint "outbox_messages_attempts_non_negative" check ("attempts" >= 0)
      );
    `);
    this.addSql(
      'create index "wager_transactions_provider_external_idx" on "wager_transactions" ("provider_id", "external_transaction_id");',
    );
    this.addSql(
      'create index "wager_transactions_wallet_idx" on "wager_transactions" ("wallet_id");',
    );
    this.addSql(
      'create index "wager_transactions_round_idx" on "wager_transactions" ("round_id");',
    );
    this.addSql(
      'create index "wallet_ledger_entries_wallet_idx" on "wallet_ledger_entries" ("wallet_id");',
    );
    this.addSql(
      'create index "outbox_messages_pending_idx" on "outbox_messages" ("published_at", "next_attempt_at");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "outbox_messages" cascade;');
    this.addSql('drop table if exists "inbox_messages" cascade;');
    this.addSql('drop table if exists "wallet_ledger_entries" cascade;');
    this.addSql('drop table if exists "wager_transactions" cascade;');
    this.addSql('drop table if exists "wallets" cascade;');
  }
}
