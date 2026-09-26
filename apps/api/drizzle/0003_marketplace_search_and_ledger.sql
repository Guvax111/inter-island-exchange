-- Category tree: parent must be another category.
ALTER TABLE categories
  ADD CONSTRAINT categories_parent_fk FOREIGN KEY (parent_id) REFERENCES categories(id),
  ADD CONSTRAINT categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
--> statement-breakpoint
-- Product search: stemmed full-text vector (weighted) plus trigram index for partial words ("diap").
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE products ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(short_description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX products_search_idx ON products USING gin (search_vector);
--> statement-breakpoint
CREATE INDEX products_title_trgm_idx ON products USING gin (title gin_trgm_ops);
--> statement-breakpoint
-- The stock ledger is history: no edits or deletions.
CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION iie_reject_modification();
--> statement-breakpoint
CREATE TRIGGER inventory_movements_no_truncate
  BEFORE TRUNCATE ON inventory_movements
  FOR EACH STATEMENT EXECUTE FUNCTION iie_reject_modification();
