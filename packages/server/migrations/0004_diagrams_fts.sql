-- Issue #5 / Wave 1: full-text search on diagrams.
--
-- Adds a generated `search_tsv` column that combines `name` (weight A) and
-- `dsl` (weight B) so name matches rank higher than DSL-content matches.
-- A GIN index over the tsvector makes `search_tsv @@ to_tsquery(...)` queries
-- O(log n) instead of full-scan.
--
-- A second GIN index over `meta->'tags'` makes tag-containment queries
-- (`meta->'tags' @> '["foo"]'::jsonb`) index-backed for `search_diagrams`'s
-- ALL-of-tags filter.
--
-- `coalesce(...)` keeps the generated column NOT NULL even when name or dsl
-- is missing; without it, a single NULL in either source field would make
-- the whole tsvector NULL and exclude the row from search entirely.
--
-- `setweight` is the canonical Postgres mechanism for boosting matches in
-- specific fields when ranking with `ts_rank` / `ts_rank_cd` — agents
-- searching for "auth" will see a diagram named "auth-flow" before a
-- diagram whose DSL merely contains the word "auth" somewhere in a label.

ALTER TABLE diagrams
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(dsl, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_diagrams_search_tsv
  ON diagrams USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS idx_diagrams_meta_tags
  ON diagrams USING GIN ((meta -> 'tags'));
