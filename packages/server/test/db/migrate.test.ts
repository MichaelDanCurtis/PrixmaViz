import { describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations");

// This test is special: it asserts what `runMigrations` *itself* does to the
// schema, so it can't use `setupTestDb` (which already calls `runMigrations`).
// Instead it allocates its own schema per `it`, runs migrations into it,
// asserts, and drops the schema.

async function withSchema(): Promise<{ schema: string; cleanup: () => Promise<void> }> {
  const schema = `mig_${crypto.randomUUID().replace(/-/g, "")}`;
  const adminSql = postgres(TEST_DB_URL, { onnotice: () => {} });
  await adminSql.unsafe(`CREATE SCHEMA "${schema}"`);
  await adminSql.end();
  return {
    schema,
    cleanup: async () => {
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
    const { schema, cleanup } = await withSchema();
    try {
      await runMigrations(TEST_DB_URL, MIGRATIONS_DIR, { searchPath: schema });

      const verifySql = postgres(TEST_DB_URL, {
        onnotice: () => {},
        connection: { search_path: schema },
      });
      try {
        const tables = await verifySql`
          SELECT tablename FROM pg_tables
          WHERE schemaname = ${schema}
          ORDER BY tablename
        `;
        expect(tables.map((t) => t.tablename)).toEqual([
          "annotations", "diagram_versions", "diagrams", "schema_migrations", "workspaces",
        ]);

        const before = await verifySql`SELECT COUNT(*)::int as n FROM schema_migrations`;
        const initialCount = before[0]!.n;
        expect(initialCount).toBeGreaterThan(0);

        // Run again — should be idempotent
        await runMigrations(TEST_DB_URL, MIGRATIONS_DIR, { searchPath: schema });
        const counts = await verifySql`SELECT COUNT(*)::int as n FROM schema_migrations`;
        expect(counts[0]!.n).toBe(initialCount);
      } finally {
        await verifySql.end();
      }
    } finally {
      await cleanup();
    }
  });
});
