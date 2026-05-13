CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,
  camera        JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  tiles         JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diagrams (
  id            TEXT PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  engine        TEXT NOT NULL,
  kind          TEXT NOT NULL,
  ir            JSONB,
  dsl           TEXT,
  svg           TEXT,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_view   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_diagrams_workspace ON diagrams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_diagrams_public ON diagrams(id) WHERE public_view = true;

CREATE TABLE IF NOT EXISTS annotations (
  id              TEXT PRIMARY KEY,
  diagram_id      TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  text            TEXT,
  color           TEXT,
  resolved_at     TIMESTAMPTZ,
  target_nodes    JSONB,
  bbox_pixel      JSONB,
  bbox_data       JSONB,
  point           JSONB,
  nearest_node    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotations_diagram ON annotations(diagram_id);
CREATE INDEX IF NOT EXISTS idx_annotations_unresolved ON annotations(diagram_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
