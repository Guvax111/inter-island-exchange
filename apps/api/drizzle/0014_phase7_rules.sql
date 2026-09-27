-- Support conversations are part of the record.
CREATE TRIGGER support_messages_append_only BEFORE UPDATE OR DELETE ON support_messages
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER support_messages_no_truncate BEFORE TRUNCATE ON support_messages
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE INDEX help_articles_search_idx ON help_articles USING gin (to_tsvector('english', title || ' ' || summary || ' ' || body));
