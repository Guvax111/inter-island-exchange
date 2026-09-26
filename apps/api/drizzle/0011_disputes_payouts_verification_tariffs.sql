CREATE TABLE "dispute_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispute_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_messages_role_chk" CHECK (author_role in ('BUYER', 'SELLER', 'IIE'))
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"decision" varchar(30),
	"refund_amount_minor" bigint,
	"return_required" boolean DEFAULT false NOT NULL,
	"return_instructions" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "disputes_status_chk" CHECK (status in ('OPEN', 'RESOLVED')),
	CONSTRAINT "disputes_decision_chk" CHECK ("disputes"."decision" is null or "disputes"."decision" in ('FULL_REFUND', 'PARTIAL_REFUND', 'RELEASE_TO_SELLER'))
);
--> statement-breakpoint
CREATE TABLE "seller_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"original_name" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "seller_documents_type_chk" CHECK (type in ('BUSINESS_REGISTRATION', 'NATIONAL_ID')),
	CONSTRAINT "seller_documents_status_chk" CHECK (status in ('PENDING', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "tariff_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"source" varchar(200) NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_by" uuid NOT NULL,
	"activated_by" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_imports_status_chk" CHECK (status in ('DRAFT', 'ACTIVE', 'DISCARDED'))
);
--> statement-breakpoint
CREATE TABLE "tariff_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"schedule_id" uuid NOT NULL,
	"hs_code" varchar(12) NOT NULL,
	"description" text NOT NULL,
	"duty_bps" integer,
	"caricom_duty_bps" integer,
	"vat_bps" integer,
	"rate_text" varchar(100),
	"restriction" varchar(20) DEFAULT 'NONE' NOT NULL,
	"notes" text,
	CONSTRAINT "tariff_lines_schedule_hs_uq" UNIQUE("schedule_id","hs_code"),
	CONSTRAINT "tariff_lines_restriction_chk" CHECK (restriction in ('NONE', 'LICENCE_REQUIRED', 'PROHIBITED'))
);
--> statement-breakpoint
CREATE TABLE "tariff_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_schedules_import_country_uq" UNIQUE("import_id","country_id"),
	CONSTRAINT "tariff_schedules_status_chk" CHECK (status in ('DRAFT', 'ACTIVE', 'RETIRED'))
);
--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_kind_chk";--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "payouts_status_chk";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "tariff_description" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "tariff_hs_code" varchar(12);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "duty_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "vat_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "tariff_source" varchar(200);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "review_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_imports" ADD CONSTRAINT "tariff_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_imports" ADD CONSTRAINT "tariff_imports_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_lines" ADD CONSTRAINT "tariff_lines_schedule_id_tariff_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."tariff_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_schedules" ADD CONSTRAINT "tariff_schedules_import_id_tariff_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."tariff_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_schedules" ADD CONSTRAINT "tariff_schedules_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispute_messages_dispute_idx" ON "dispute_messages" USING btree ("dispute_id","id");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "seller_documents_seller_idx" ON "seller_documents" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_schedules_one_active_uq" ON "tariff_schedules" USING btree ("country_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "transactions_review_ends_idx" ON "transactions" USING btree ("review_ends_at") WHERE status = 'DISPUTE_WINDOW';--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kind_chk" CHECK (kind in ('PRODUCT_IMAGE', 'STORE_LOGO', 'DELIVERY_PHOTO', 'DELIVERY_SIGNATURE', 'DISPUTE_EVIDENCE'));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_status_chk" CHECK (status in ('ON_HOLD', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'));