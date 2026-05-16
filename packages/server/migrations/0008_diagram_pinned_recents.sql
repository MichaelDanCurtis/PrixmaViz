-- Issue #7 / Wave 1A: pinned diagrams + "recently opened" surface.
--
-- `pinned` floats a diagram into a dedicated section at the top of the
-- Library. `last_opened_at` powers the "Recent" section (last N opened).
--
-- The partial index covers ONLY rows with a non-null `last_opened_at` —
-- a freshly-imported workspace where nothing has been opened yet won't
-- carry index bloat, and the index entries that exist are exactly what
-- the recent-N query reads (ORDER BY ... DESC NULLS LAST LIMIT N).
--
-- Write semantics for `last_opened_at` (in src/db/diagrams.ts ::
-- dbBumpLastOpenedAt) are debounced: a no-op when the column was bumped
-- within the last second. This keeps a tight WS reconnect loop from
-- producing a write storm.

ALTER TABLE diagrams
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_diagrams_recent
  ON diagrams(workspace_id, last_opened_at DESC NULLS LAST)
  WHERE last_opened_at IS NOT NULL;
