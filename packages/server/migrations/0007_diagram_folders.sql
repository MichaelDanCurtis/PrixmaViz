-- Issue #7 / Wave 1A: per-diagram folder path.
--
-- Adds `parent_path` to `diagrams` so the Library can render a folder tree
-- instead of a flat list. Empty string ('') is the workspace root. Non-empty
-- values are Unix-style slash-delimited segments with no leading or trailing
-- slash (validated by the application layer; see dbMoveDiagram /
-- dbRenameFolder for the regex).
--
-- Empty folders (folders with no diagrams in them yet) live in
-- `workspaces.settings.emptyFolders: string[]`. The `settings` JSONB column
-- already exists from 0001_init.sql, so no schema change is needed for that
-- — only the read/write helpers in src/db/folders.ts.
--
-- The composite (workspace_id, parent_path) index supports the Library's
-- "list children of folder X" query and the folder-rename cascade
-- (`starts_with(parent_path, '<from>/')`).

ALTER TABLE diagrams
  ADD COLUMN IF NOT EXISTS parent_path TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_diagrams_parent_path
  ON diagrams(workspace_id, parent_path);
