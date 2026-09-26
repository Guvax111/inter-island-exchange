-- Dispute conversations are part of the record: no edits or deletions.
CREATE TRIGGER dispute_messages_append_only BEFORE UPDATE OR DELETE ON dispute_messages
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER dispute_messages_no_truncate BEFORE TRUNCATE ON dispute_messages
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
-- Tariff lookups: HS code prefixes within a schedule, and word search in descriptions.
CREATE INDEX tariff_lines_prefix_idx ON tariff_lines (schedule_id, hs_code text_pattern_ops);
--> statement-breakpoint
CREATE INDEX tariff_lines_search_idx ON tariff_lines USING gin (to_tsvector('english', description));
