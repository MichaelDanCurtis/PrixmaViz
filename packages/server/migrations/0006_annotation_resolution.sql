-- Issue #5 / Wave 1: persist annotation resolution text + author alongside
-- the existing `resolved_at` timestamp.
--
-- 0001_init.sql already created `annotations.resolved_at TIMESTAMPTZ NULL`,
-- so this migration is idempotent on the timestamp side (the `IF NOT
-- EXISTS` guard makes re-running safe). New additions:
--   * `resolution TEXT NULL` — free-form "why was this resolved?" text
--     stored by `resolve_annotation` and surfaced by `get_annotations`
--     when `includeResolved: true`.
--   * `author TEXT NULL` — free-form attribution ("agent", "alice", etc.)
--     so MCP-driven and UI-driven writes can be distinguished downstream.

ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS resolution TEXT NULL,
  ADD COLUMN IF NOT EXISTS author TEXT NULL;
