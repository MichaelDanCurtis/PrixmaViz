-- Issue #8 / Wave 1A: share links with permission tiers + token-based access.
--
-- Replaces the binary `diagrams.public_view` flag (kept for backward-compat)
-- with an actual row-per-share table keyed by an opaque token. Each share
-- carries a permission tier (`view` / `comment` / `edit`) and an optional
-- `expires_at` so links can self-revoke without an explicit DELETE.
--
-- Auth model:
--   - Bearer-token (= workspaceId) auth gates the management API
--     (POST /api/diagrams/:id/shares, GET, DELETE).
--   - Public GET /s/:token resolves the share without any auth header.
--   - The token is a 256-bit URL-safe random string; collisions are
--     statistically impossible inside a single migration's row count.
--   - We deliberately do NOT store creator user identity beyond the
--     workspaceId — the public-key cryptography for "who created this
--     link" is out of scope for v1.
--
-- Indexes:
--   - idx_share_links_token: token-keyed resolve hits the GET /s/:token
--     and DELETE /api/shares/:token paths; UNIQUE so duplicate tokens
--     are impossible by construction (the random generator is
--     statistically safe; the UNIQUE is a defense in depth).
--   - idx_share_links_diagram: (diagram_id, created_by) composite covers
--     the GET /api/diagrams/:id/shares listing (owner-scoped).
--
-- Backfill:
--   Every existing diagram with `public_view = TRUE` gets a view-only
--   share row so deep-links that have been pasted in chat / docs keep
--   working after this migration ships. The token format matches the
--   live generator so old `/p/:id` URLs continue to work via the
--   existing route — the new `/s/:token` is purely additive.

CREATE TABLE IF NOT EXISTS share_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id      TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  token           TEXT NOT NULL,
  permission      TEXT NOT NULL CHECK (permission IN ('view', 'comment', 'edit')),
  expires_at      TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token
  ON share_links(token);

CREATE INDEX IF NOT EXISTS idx_share_links_diagram
  ON share_links(diagram_id, created_by);

-- Backfill: existing public-true diagrams get a view-only share_link.
-- Token format: 'pub_' + first 32 hex chars of a UUID (URL-safe; matches
-- the in-app generator's character class). created_by is the diagram's
-- workspace_id since these legacy public links are effectively owned by
-- their workspace.
INSERT INTO share_links (diagram_id, token, permission, created_by)
SELECT
  id,
  'pub_' || replace(gen_random_uuid()::text, '-', ''),
  'view',
  workspace_id
FROM diagrams
WHERE public_view = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM share_links sl WHERE sl.diagram_id = diagrams.id
  );
