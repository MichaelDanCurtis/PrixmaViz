import { describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations");

// This test is special: it asserts what `runMigrations` *itself* does to the
// schema, so it can't use `setupTestDb` (which already calls `runMigrations`).
// Instead each `it` allocates its own schema, runs migrations into it,
// asserts, and drops the schema. Schemas are isolated per-test so files
// can run in parallel without racing on shared `public` tables.

async function freshMigratedSchema(): Promise<{
  schema: string;
  verify: ReturnType<typeof postgres>;
  cleanup: () => Promise<void>;
}> {
  const schema = `mig_${crypto.randomUUID().replace(/-/g, "")}`;
  const admin = postgres(TEST_DB_URL, { onnotice: () => {} });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  await admin.end();
  await runMigrations(TEST_DB_URL, MIGRATIONS_DIR, { searchPath: schema });
  const verify = postgres(TEST_DB_URL, {
    onnotice: () => {},
    connection: { search_path: schema },
  });
  return {
    schema,
    verify,
    cleanup: async () => {
      await verify.end();
      const s = postgres(TEST_DB_URL, { onnotice: () => {} });
      try {
        await s.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await s.end();
      }
    },
  };
}

describe("runMigrations", () => {
  it("applies all migrations idempotently inside a target schema", async () => {
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      // Verify the core tables exist; the suite of tables can grow over time,
      // so assert containment rather than exact equality.
      const tables = (
        await verify`SELECT tablename FROM pg_tables WHERE schemaname = ${schema}`
      ).map((t) => t.tablename as string);
      for (const expected of [
        "annotations",
        "diagrams",
        "diagram_versions",
        "schema_migrations",
        "share_links",
        "workspaces",
      ]) {
        expect(tables).toContain(expected);
      }

      // Capture migration count after first apply.
      const before = await verify`SELECT COUNT(*)::int as n FROM schema_migrations`;
      const initialCount = before[0]!.n;
      expect(initialCount).toBeGreaterThanOrEqual(8);

      // Run again — should be idempotent.
      await runMigrations(TEST_DB_URL, MIGRATIONS_DIR, { searchPath: schema });
      const counts = await verify`SELECT COUNT(*)::int as n FROM schema_migrations`;
      expect(counts[0]!.n).toBe(initialCount);
    } finally {
      await cleanup();
    }
  });

  it("0004 adds the generated search_tsv column and its GIN indexes", async () => {
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      const cols = await verify`
        SELECT column_name, data_type, is_generated
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND table_name = 'diagrams'
          AND column_name = 'search_tsv'
      `;
      expect(cols).toHaveLength(1);
      expect(cols[0]?.data_type).toBe("tsvector");
      expect(cols[0]?.is_generated).toBe("ALWAYS");

      const indexes = (
        await verify`SELECT indexname FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'diagrams'`
      ).map((r) => r.indexname as string);
      expect(indexes).toContain("idx_diagrams_search_tsv");
      expect(indexes).toContain("idx_diagrams_meta_tags");
    } finally {
      await cleanup();
    }
  });

  it("0005 adds workspaces.owner_token_hash and its partial index", async () => {
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      const cols = await verify`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = 'workspaces'
          AND column_name = 'owner_token_hash'
      `;
      expect(cols).toHaveLength(1);
      expect(cols[0]?.is_nullable).toBe("YES");

      const idx = await verify`
        SELECT indexname FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'workspaces'
          AND indexname = 'idx_workspaces_owner_token_hash'
      `;
      expect(idx).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("0006 adds annotations.resolution and ensures resolved_at exists", async () => {
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      const cols = await verify`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = 'annotations'
          AND column_name IN ('resolved_at', 'resolution')
      `;
      const byName = Object.fromEntries(
        cols.map((r) => [r.column_name as string, r as Record<string, unknown>]),
      );
      expect(byName.resolved_at).toBeDefined();
      expect(byName.resolution).toBeDefined();
      expect(byName.resolution?.data_type).toBe("text");
      expect(byName.resolution?.is_nullable).toBe("YES");
      expect(byName.resolved_at?.is_nullable).toBe("YES");
    } finally {
      await cleanup();
    }
  });

  it("0007 adds diagrams.parent_path with default '' and its composite index", async () => {
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      const cols = await verify`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = 'diagrams'
          AND column_name = 'parent_path'
      `;
      expect(cols).toHaveLength(1);
      expect(cols[0]?.data_type).toBe("text");
      expect(cols[0]?.is_nullable).toBe("NO");
      // Postgres normalises the default literal — accept either '' or ''::text
      expect(String(cols[0]?.column_default ?? "")).toMatch(/^''(?:::text)?$/);

      const idx = await verify`
        SELECT indexname FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'diagrams'
          AND indexname = 'idx_diagrams_parent_path'
      `;
      expect(idx).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("0008 adds diagrams.pinned + last_opened_at + partial recent index", async () => {
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      const cols = await verify`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = 'diagrams'
          AND column_name IN ('pinned', 'last_opened_at')
      `;
      const byName = Object.fromEntries(
        cols.map((r) => [r.column_name as string, r as Record<string, unknown>]),
      );
      expect(byName.pinned).toBeDefined();
      expect(byName.pinned?.data_type).toBe("boolean");
      expect(byName.pinned?.is_nullable).toBe("NO");
      expect(String(byName.pinned?.column_default ?? "").toLowerCase()).toBe("false");
      expect(byName.last_opened_at).toBeDefined();
      expect(byName.last_opened_at?.data_type).toBe("timestamp with time zone");
      expect(byName.last_opened_at?.is_nullable).toBe("YES");

      const idx = await verify<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'diagrams'
          AND indexname = 'idx_diagrams_recent'
      `;
      expect(idx).toHaveLength(1);
      expect(idx[0]?.indexdef).toMatch(/WHERE \(last_opened_at IS NOT NULL\)/);
      expect(idx[0]?.indexdef).toMatch(/DESC/);
    } finally {
      await cleanup();
    }
  });

  it("0010 adds share_links table + token/diagram indexes + permission CHECK", async () => {
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      const cols = await verify`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = 'share_links'
        ORDER BY column_name
      `;
      const names = cols.map((r) => r.column_name as string).sort();
      expect(names).toEqual([
        "created_at",
        "created_by",
        "diagram_id",
        "expires_at",
        "id",
        "permission",
        "token",
      ]);

      const indexes = await verify<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'share_links'
      `;
      const byName = Object.fromEntries(indexes.map((r) => [r.indexname, r.indexdef]));
      expect(byName.idx_share_links_token).toBeDefined();
      expect(byName.idx_share_links_token).toMatch(/UNIQUE/);
      expect(byName.idx_share_links_diagram).toBeDefined();
      expect(byName.idx_share_links_diagram).toMatch(/diagram_id/);
      expect(byName.idx_share_links_diagram).toMatch(/created_by/);

      // CHECK constraint on permission column rejects unknown values. Build a
      // real workspace + diagram so we get past the FK constraints and
      // exercise ONLY the CHECK on the permission column.
      const ws = await verify<{ id: string }[]>`
        INSERT INTO workspaces DEFAULT VALUES RETURNING id
      `;
      const wsId = ws[0]!.id;
      await verify`
        INSERT INTO diagrams (id, workspace_id, slug, name, engine, kind)
        VALUES ('d_check_test', ${wsId}, 'check-test', 'Check Test', 'mermaid', 'graph')
      `;
      try {
        await verify`
          INSERT INTO share_links (diagram_id, token, permission, created_by)
          VALUES ('d_check_test', 's_check_test', 'admin', ${wsId})
        `;
        throw new Error("expected CHECK to reject 'admin' permission");
      } catch (e) {
        // Postgres CHECK violation code is 23514.
        expect((e as { code?: string }).code).toBe("23514");
      }
    } finally {
      await cleanup();
    }
  });

  it("0010 backfill creates a view-only share_link for public_view=TRUE diagrams", async () => {
    // Seed a workspace + public diagram, clear the 0010 row, then replay 0010
    // and assert backfill ran. All inside a per-test schema.
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      const ws = await verify<{ id: string }[]>`
        INSERT INTO workspaces DEFAULT VALUES RETURNING id
      `;
      const wsId = ws[0]!.id;
      await verify`
        INSERT INTO diagrams (id, workspace_id, slug, name, engine, kind, public_view)
        VALUES ('d_pub_test', ${wsId}, 'pub-test', 'Pub Test', 'mermaid', 'graph', TRUE)
      `;
      // Clear any backfill from the first pass, then replay just 0010.
      await verify`TRUNCATE share_links`;
      await verify`DELETE FROM schema_migrations WHERE filename = '0010_share_links.sql'`;

      await runMigrations(TEST_DB_URL, MIGRATIONS_DIR, { searchPath: schema });

      const rows = await verify`
        SELECT permission, token, created_by FROM share_links WHERE diagram_id = 'd_pub_test'
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.permission).toBe("view");
      expect(rows[0]!.created_by).toBe(wsId);
      expect(rows[0]!.token).toMatch(/^pub_[0-9a-f]{32}$/);
    } finally {
      await cleanup();
    }
  });

  it("0004/0005/0006/0007/0008 are individually idempotent on an already-migrated DB", async () => {
    // Verifies the spec promise that the wave-1 migrations all use IF NOT
    // EXISTS so they can safely be re-applied even if their
    // schema_migrations row is missing or rebuilt. We replay ONLY those that
    // opted into idempotency (not the older non-idempotent 0001/0002) by
    // deleting their schema_migrations entries.
    const { schema, verify, cleanup } = await freshMigratedSchema();
    try {
      await verify`DELETE FROM schema_migrations WHERE filename IN (
        '0004_diagrams_fts.sql',
        '0005_workspace_owner.sql',
        '0006_annotation_resolution.sql',
        '0007_diagram_folders.sql',
        '0008_diagram_pinned_recents.sql',
        '0010_share_links.sql'
      )`;
      await expect(
        runMigrations(TEST_DB_URL, MIGRATIONS_DIR, { searchPath: schema })
      ).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
