CREATE TABLE "duty_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_country_id" uuid NOT NULL,
	"hs_prefix" varchar(10) DEFAULT '' NOT NULL,
	"caricom_origin_duty_bps" integer NOT NULL,
	"other_origin_duty_bps" integer NOT NULL,
	"vat_bps" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_estimates_dest_prefix_uq" UNIQUE("destination_country_id","hs_prefix")
);
--> statement-breakpoint
CREATE TABLE "fee_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane_id" uuid,
	"percent_bps" integer NOT NULL,
	"default_payer" varchar(10) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_rules_lane_uq" UNIQUE NULLS NOT DISTINCT("lane_id"),
	CONSTRAINT "fee_rules_bps_chk" CHECK ("fee_rules"."percent_bps" between 0 and 10000),
	CONSTRAINT "fee_rules_payer_chk" CHECK (default_payer in ('BUYER', 'SELLER'))
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_qty_chk" CHECK ("inventory_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "lane_shipping_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane_id" uuid NOT NULL,
	"service_name" varchar(80) NOT NULL,
	"max_weight_grams" integer NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lane_shipping_rates_price_chk" CHECK ("lane_shipping_rates"."price_minor" >= 0),
	CONSTRAINT "lane_shipping_rates_weight_chk" CHECK ("lane_shipping_rates"."max_weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"link" varchar(300),
	"transaction_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(64) NOT NULL,
	"title" varchar(150) NOT NULL,
	"variant_name" varchar(100) NOT NULL,
	"hs_code" varchar(10),
	"country_of_origin" char(2) NOT NULL,
	"unit_weight_grams" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	CONSTRAINT "order_items_quantity_chk" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"delivery_address" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"currency_code" char(3) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"total_minor" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"from_status" varchar(40),
	"to_status" varchar(40) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iie_id" varchar(40) NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"origin_country_id" uuid NOT NULL,
	"destination_country_id" uuid NOT NULL,
	"status" varchar(40) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"held_from_status" varchar(40),
	"payment_status" varchar(30) DEFAULT 'NOT_STARTED' NOT NULL,
	"shipment_status" varchar(30) DEFAULT 'NOT_STARTED' NOT NULL,
	"customs_status" varchar(30) DEFAULT 'NOT_STARTED' NOT NULL,
	"compliance_status" varchar(30) DEFAULT 'NOT_CHECKED' NOT NULL,
	"dispute_status" varchar(30) DEFAULT 'NONE' NOT NULL,
	"payout_status" varchar(30) DEFAULT 'NOT_STARTED' NOT NULL,
	"transaction_currency" char(3) NOT NULL,
	"buyer_currency" char(3) NOT NULL,
	"payout_currency" char(3) NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"fx_source" varchar(40) DEFAULT 'SAME_CURRENCY' NOT NULL,
	"fx_recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"shipping_minor" bigint NOT NULL,
	"platform_fee_minor" bigint NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"fee_payer" varchar(10) NOT NULL,
	"other_fees_minor" bigint DEFAULT 0 NOT NULL,
	"duties_estimate_minor" bigint NOT NULL,
	"duties_collected" boolean DEFAULT false NOT NULL,
	"total_minor" bigint NOT NULL,
	"seller_payout_minor" bigint NOT NULL,
	"payment_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_iie_id_unique" UNIQUE("iie_id"),
	CONSTRAINT "transactions_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "transactions_fee_payer_chk" CHECK (fee_payer in ('BUYER', 'SELLER'))
);
--> statement-breakpoint
ALTER TABLE "seller_storefronts" ADD COLUMN "fee_payer" varchar(10);--> statement-breakpoint
ALTER TABLE "duty_estimates" ADD CONSTRAINT "duty_estimates_destination_country_id_countries_id_fk" FOREIGN KEY ("destination_country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_lane_id_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."lanes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_shipping_rates" ADD CONSTRAINT "lane_shipping_rates_lane_id_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."lanes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_shipping_rates" ADD CONSTRAINT "lane_shipping_rates_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_origin_country_id_countries_id_fk" FOREIGN KEY ("origin_country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_destination_country_id_countries_id_fk" FOREIGN KEY ("destination_country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transaction_currency_currencies_code_fk" FOREIGN KEY ("transaction_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyer_currency_currencies_code_fk" FOREIGN KEY ("buyer_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payout_currency_currencies_code_fk" FOREIGN KEY ("payout_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_reservations_tx_idx" ON "inventory_reservations" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "lane_shipping_rates_lane_idx" ON "lane_shipping_rates" USING btree ("lane_id","max_weight_grams");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "quotes_buyer_idx" ON "quotes" USING btree ("buyer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_events_tx_idx" ON "transaction_events" USING btree ("transaction_id","id");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transactions_buyer_idx" ON "transactions" USING btree ("buyer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_seller_idx" ON "transactions" USING btree ("seller_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_payment_due_idx" ON "transactions" USING btree ("payment_due_at") WHERE status = 'AWAITING_PAYMENT';