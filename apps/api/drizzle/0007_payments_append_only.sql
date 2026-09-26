-- Payment history, the ledger and exchange rates are permanent records.
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON payment_events
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER exchange_rates_append_only BEFORE UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
-- Each ledger posting must balance: checked when the inserting transaction commits.
CREATE OR REPLACE FUNCTION iie_check_posting_balanced() RETURNS trigger AS $$
DECLARE
  imbalance bigint;
BEGIN
  SELECT coalesce(sum(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE -amount_minor END), 0)
    INTO imbalance FROM ledger_entries WHERE posting_id = NEW.posting_id;
  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'ledger posting % does not balance (debits - credits = %)', NEW.posting_id, imbalance;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iie_check_posting_balanced();
