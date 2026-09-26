CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_cart_variant_uq" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_items_quantity_chk" CHECK ("cart_items"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" varchar(80) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "hs_codes" (
	"code" varchar(10) PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"quantity_reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_on_hand_chk" CHECK ("inventory"."quantity_on_hand" >= 0),
	CONSTRAINT "inventory_reserved_chk" CHECK ("inventory"."quantity_reserved" >= 0 and "inventory"."quantity_reserved" <= "inventory"."quantity_on_hand")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason" varchar(30) NOT NULL,
	"note" varchar(200),
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_reason_chk" CHECK (reason in ('INITIAL', 'STOCK_COUNT', 'SALE', 'RETURN', 'CORRECTION'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_assets_kind_chk" CHECK (kind in ('PRODUCT_IMAGE', 'STORE_LOGO'))
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"alt_text" varchar(200) DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_media_id_unique" UNIQUE("media_id")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"sku" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency_code" char(3) NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_seller_sku_uq" UNIQUE("seller_profile_id","sku"),
	CONSTRAINT "product_variants_price_chk" CHECK ("product_variants"."price_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"title" varchar(150) NOT NULL,
	"short_description" varchar(300) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid NOT NULL,
	"brand" varchar(100),
	"hs_code" varchar(10),
	"country_of_origin_id" uuid NOT NULL,
	"weight_grams" integer,
	"length_mm" integer,
	"width_mm" integer,
	"height_mm" integer,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_notes" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_status_chk" CHECK (status in ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'OUT_OF_STOCK', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "saved_products" (
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_products_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "saved_sellers" (
	"user_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_sellers_user_id_seller_profile_id_pk" PRIMARY KEY("user_id","seller_profile_id")
);
--> statement-breakpoint
CREATE TABLE "seller_storefronts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"slug" varchar(60) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo_media_id" uuid,
	"shipping_origin" varchar(100) DEFAULT '' NOT NULL,
	"return_policy" text DEFAULT '' NOT NULL,
	"store_policies" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_storefronts_seller_profile_id_unique" UNIQUE("seller_profile_id"),
	CONSTRAINT "seller_storefronts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "payout_setup_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "payout_setup_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "payout_setup_note" text;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_country_of_origin_id_countries_id_fk" FOREIGN KEY ("country_of_origin_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_sellers" ADD CONSTRAINT "saved_sellers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_sellers" ADD CONSTRAINT "saved_sellers_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_storefronts" ADD CONSTRAINT "seller_storefronts_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_storefronts" ADD CONSTRAINT "seller_storefronts_logo_media_id_media_assets_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_variant_idx" ON "inventory_movements" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_seller_status_idx" ON "products" USING btree ("seller_profile_id","status");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_status_published_idx" ON "products" USING btree ("status","published_at");--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_payout_setup_confirmed_by_users_id_fk" FOREIGN KEY ("payout_setup_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;