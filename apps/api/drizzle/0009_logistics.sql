CREATE TABLE "delivery_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"recipient_name" varchar(120) NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"photo_media_id" uuid,
	"signature_media_id" uuid,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_proofs_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
CREATE TABLE "partner_lanes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_lanes_uq" UNIQUE("partner_id","lane_id")
);
--> statement-breakpoint
CREATE TABLE "partner_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_members_uq" UNIQUE("partner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "service_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"country_id" uuid NOT NULL,
	"contact_email" varchar(254) NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"clears_customs" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_partners_kind_chk" CHECK (kind in ('LOGISTICS', 'CUSTOMS_BROKER'))
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"step" varchar(40) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"partner_id" uuid,
	"location" varchar(120),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"logistics_partner_id" uuid,
	"customs_broker_id" uuid,
	"pickup_address" jsonb NOT NULL,
	"pickup_contact" jsonb NOT NULL,
	"delivery_address" jsonb NOT NULL,
	"delivery_contact" jsonb NOT NULL,
	"declared_weight_grams" integer NOT NULL,
	"parcel_weight_grams" integer NOT NULL,
	"actual_weight_grams" integer,
	"weight_flagged" boolean DEFAULT false NOT NULL,
	"pickup_notes" text DEFAULT '' NOT NULL,
	"pickup_scheduled_for" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"tracking_reference" varchar(60),
	"customs_entry_number" varchar(60),
	"duties_assessed_minor" bigint,
	"currency_code" char(3) NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "shipments_weights_chk" CHECK ("shipments"."declared_weight_grams" > 0 and "shipments"."parcel_weight_grams" > 0)
);
--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_kind_chk";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "delivery_confirm_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_photo_media_id_media_assets_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_signature_media_id_media_assets_id_fk" FOREIGN KEY ("signature_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_lanes" ADD CONSTRAINT "partner_lanes_partner_id_service_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."service_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_lanes" ADD CONSTRAINT "partner_lanes_lane_id_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."lanes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_partner_id_service_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."service_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_partners" ADD CONSTRAINT "service_partners_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_partner_id_service_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."service_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_logistics_partner_id_service_partners_id_fk" FOREIGN KEY ("logistics_partner_id") REFERENCES "public"."service_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customs_broker_id_service_partners_id_fk" FOREIGN KEY ("customs_broker_id") REFERENCES "public"."service_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_lanes_lane_idx" ON "partner_lanes" USING btree ("lane_id");--> statement-breakpoint
CREATE INDEX "partner_members_user_idx" ON "partner_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "service_partners_kind_country_idx" ON "service_partners" USING btree ("kind","country_id");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("shipment_id","id");--> statement-breakpoint
CREATE INDEX "shipments_logistics_idx" ON "shipments" USING btree ("logistics_partner_id");--> statement-breakpoint
CREATE INDEX "shipments_broker_idx" ON "shipments" USING btree ("customs_broker_id");--> statement-breakpoint
CREATE INDEX "transactions_delivery_due_idx" ON "transactions" USING btree ("delivery_confirm_due_at") WHERE status = 'DELIVERED';--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kind_chk" CHECK (kind in ('PRODUCT_IMAGE', 'STORE_LOGO', 'DELIVERY_PHOTO', 'DELIVERY_SIGNATURE'));