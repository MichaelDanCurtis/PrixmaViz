-- Issue #5 / Wave 1: persist annotation resolution text alongside the
-- existing `resolved_at` timestamp.
--
-- 0001_init.sql already created `annotations.resolved_at TIMESTAMPTZ NULL`,
-- so this migration is idempotent on the timestamp side (the `IF NOT
-- EXISTS` guard makes re-running safe). The new addition is
-- `resolution TEXT NULL` — the free-form "why was this resolved?" text
-- that `resolve_annotation` (Wave 2) will store and `get_annotations`
-- will surface when `includeResolved: true`.

ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL;

ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS resolution TEXT NULL;
