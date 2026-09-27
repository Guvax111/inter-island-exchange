CREATE TABLE "help_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"title" varchar(150) NOT NULL,
	"audience" varchar(10) NOT NULL,
	"summary" varchar(300) DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"updated_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "help_articles_audience_chk" CHECK (audience in ('BUYER', 'SELLER', 'PARTNER', 'ALL')),
	CONSTRAINT "help_articles_status_chk" CHECK (status in ('DRAFT', 'PUBLISHED'))
);
--> statement-breakpoint
CREATE TABLE "report_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"name" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_recipients_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"recipients" integer NOT NULL,
	"figures" jsonb NOT NULL,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_runs_kind_chk" CHECK (kind in ('SCHEDULED', 'MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"title" varchar(120),
	"body" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"moderation_note" text,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "reviews_rating_chk" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_status_chk" CHECK (status in ('PENDING', 'PUBLISHED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "seller_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"remaining_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"status" varchar(20) DEFAULT 'OUTSTANDING' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_charges_status_chk" CHECK (status in ('OUTSTANDING', 'RECOVERED')),
	CONSTRAINT "seller_charges_amounts_chk" CHECK ("seller_charges"."remaining_minor" >= 0 and "seller_charges"."remaining_minor" <= "seller_charges"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(30) NOT NULL,
	"transaction_id" uuid NOT NULL,
	"partner_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'DUE' NOT NULL,
	"paid_at" timestamp with time zone,
	"reference" varchar(120),
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_kind_tx_uq" UNIQUE("kind","transaction_id"),
	CONSTRAINT "settlements_kind_chk" CHECK (kind in ('PROVIDER_REMITTANCE', 'LOGISTICS_PAYMENT')),
	CONSTRAINT "settlements_status_chk" CHECK (status in ('DUE', 'PAID'))
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_role_chk" CHECK (author_role in ('USER', 'IIE'))
);
--> statement-breakpoint
CREATE TABLE "support_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" varchar(150) NOT NULL,
	"transaction_id" uuid,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"last_author_role" varchar(10) DEFAULT 'USER' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_threads_status_chk" CHECK (status in ('OPEN', 'CLOSED'))
);
--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD COLUMN "visible_to" varchar(10) DEFAULT 'BOTH' NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "shipping_borne_by" varchar(10);--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "deducted_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_charges" ADD CONSTRAINT "seller_charges_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_charges" ADD CONSTRAINT "seller_charges_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_charges" ADD CONSTRAINT "seller_charges_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_partner_id_service_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."service_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_scheduled_week_uq" ON "report_runs" USING btree ("week_start") WHERE kind = 'SCHEDULED';--> statement-breakpoint
CREATE INDEX "reviews_seller_idx" ON "reviews" USING btree ("seller_profile_id","status");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "seller_charges_seller_idx" ON "seller_charges" USING btree ("seller_profile_id","status");--> statement-breakpoint
CREATE INDEX "settlements_due_idx" ON "settlements" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "support_messages_thread_idx" ON "support_messages" USING btree ("thread_id","id");--> statement-breakpoint
CREATE INDEX "support_threads_user_idx" ON "support_threads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_threads_status_idx" ON "support_threads" USING btree ("status","last_message_at");--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_visible_chk" CHECK (visible_to in ('BUYER', 'SELLER', 'BOTH'));