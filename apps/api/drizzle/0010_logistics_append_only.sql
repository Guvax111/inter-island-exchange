-- Tracking history and proofs of delivery are permanent records.
CREATE TRIGGER shipment_events_append_only BEFORE UPDATE OR DELETE ON shipment_events
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER shipment_events_no_truncate BEFORE TRUNCATE ON shipment_events
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER delivery_proofs_append_only BEFORE UPDATE OR DELETE ON delivery_proofs
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER delivery_proofs_no_truncate BEFORE TRUNCATE ON delivery_proofs
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
