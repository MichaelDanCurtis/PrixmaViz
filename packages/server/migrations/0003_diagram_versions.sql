-- Issue #6: per-diagram version history.
--
-- Each row is a snapshot of a diagram's renderable source (DSL for
-- passthrough engines, the engine name and kind for context). The snapshot
-- is written BEFORE an update overwrites the live `diagrams` row, so the
-- history table can never contain the current version — only ancestors.
--
-- A diagram is the source-of-truth; this table stores diffs/history.
-- It is additive and non-breaking: existing diagrams without any versions
-- continue to work as before (the API simply returns an empty list).
CREATE TABLE IF NOT EXISTS diagram_versions (
  id           TEXT PRIMARY KEY,
  diagram_id   TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  engine       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  source       TEXT,           -- DSL text (passthrough); nullable for graph/binary kinds
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagram_versions_diagram
  ON diagram_versions(diagram_id, created_at DESC);
