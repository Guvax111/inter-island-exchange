CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_currency" char(3) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" varchar(60) NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"posting_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" varchar(40) NOT NULL,
	"direction" varchar(6) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"description" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_direction_chk" CHECK (direction in ('DEBIT', 'CREDIT')),
	CONSTRAINT "ledger_amount_chk" CHECK ("ledger_entries"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"amount_minor" bigint,
	"currency_code" char(3),
	"webhook_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_intent_id" varchar(120) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"status" varchar(20) DEFAULT 'REQUIRES_ACTION' NOT NULL,
	"redirect_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_provider_uq" UNIQUE("provider","provider_intent_id"),
	CONSTRAINT "payment_intents_status_chk" CHECK (status in ('REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"status" varchar(20) DEFAULT 'ON_HOLD' NOT NULL,
	"released_at" timestamp with time zone,
	"provider_payout_id" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "payouts_status_chk" CHECK (status in ('ON_HOLD', 'APPROVED', 'PROCESSING', 'PAID', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "provider_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"event_id" varchar(120) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"result" varchar(40),
	"error" text,
	CONSTRAINT "provider_webhooks_event_uq" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_refund_id" varchar(120),
	"amount_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"requested_by" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "refunds_status_chk" CHECK (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "refunds_amount_chk" CHECK ("refunds"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "seller_confirm_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_base_currency_currencies_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_quote_currency_currencies_code_fk" FOREIGN KEY ("quote_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_rates_pair_idx" ON "exchange_rates" USING btree ("base_currency","quote_currency","effective_at");--> statement-breakpoint
CREATE INDEX "ledger_tx_idx" ON "ledger_entries" USING btree ("transaction_id","id");--> statement-breakpoint
CREATE INDEX "ledger_posting_idx" ON "ledger_entries" USING btree ("posting_id");--> statement-breakpoint
CREATE INDEX "payment_events_intent_idx" ON "payment_events" USING btree ("payment_intent_id","id");--> statement-breakpoint
CREATE INDEX "payment_intents_tx_idx" ON "payment_intents" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "payouts_seller_idx" ON "payouts" USING btree ("seller_profile_id","status");--> statement-breakpoint
CREATE INDEX "refunds_tx_idx" ON "refunds" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_seller_due_idx" ON "transactions" USING btree ("seller_confirm_due_at") WHERE status = 'AWAITING_SELLER_CONFIRMATION';