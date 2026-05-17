-- Issue #5 / Wave 1: workspace ownership / multi-workspace auth scaffolding.
--
-- The current auth model is `bearer-token = workspace_id` (per packages/
-- server/src/auth/bearer.ts). That gives a single workspace per token and
-- no path to user-level scopes for tools like `create_workspace` and
-- `list_workspaces` (Group E of issue #5).
--
-- This migration adds an OPTIONAL `owner_token_hash` column that downstream
-- waves will populate with a sha256 hash of the bearer token. Nullable so
-- existing workspaces (with no owner token recorded) continue to work
-- exactly as today. The index supports the `list_workspaces` lookup by
-- token hash.
--
-- No production behavior changes from this migration alone — wiring lives
-- in a later wave.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS owner_token_hash TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_token_hash
  ON workspaces(owner_token_hash)
  WHERE owner_token_hash IS NOT NULL;
