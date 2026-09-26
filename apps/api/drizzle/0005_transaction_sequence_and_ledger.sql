-- One global sequence for the numeric part of IIE transaction IDs (IIE-SLU-SVG-000001).
CREATE SEQUENCE IF NOT EXISTS transaction_number_seq START 1;
--> statement-breakpoint
-- Transaction history is permanent.
CREATE TRIGGER transaction_events_append_only
  BEFORE UPDATE OR DELETE ON transaction_events
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER transaction_events_no_truncate
  BEFORE TRUNCATE ON transaction_events
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
-- The IIE ID never changes once issued.
CREATE OR REPLACE FUNCTION iie_protect_transaction_id() RETURNS trigger AS $$
BEGIN
  IF NEW.iie_id <> OLD.iie_id THEN
    RAISE EXCEPTION 'transactions.iie_id is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_iie_id_immutable
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION iie_protect_transaction_id();
