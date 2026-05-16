import { afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";

type Sql = ReturnType<typeof postgres>;

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations");

export interface TestDb {
  /** The unique schema name allocated for this test file. */
  schema: string;
  /** The shared test-database URL (search_path is bound separately). */
  url: string;
  /** Returns a getDb-cached postgres client bound to this file's schema. */
  sql: () => Sql;
  /** Drops everything in this file's schema and re-runs migrations. */
  reset: () => Promise<void>;
}

/**
 * Allocates a unique Postgres schema for this test file so parallel test
 * files (bun:test default) don't race on `DROP TABLE`/`runMigrations`
 * against the shared `public` schema.
 *
 * Registers `beforeEach` (drop+migrate inside the schema) and `afterAll`
 * (drop the schema and close the connection pool). Tests opt in by calling
 * this once at module top-level and then using the returned `sql()` instead
 * of `getDb(TEST_DB_URL)`.
 */
export function setupTestDb(): TestDb {
  const schema = `test_${crypto.randomUUID().replace(/-/g, "")}`;

  async function dropAndCreateSchema(): Promise<void> {
    const adminSql = postgres(TEST_DB_URL, { onnotice: () => {} });
    try {
      await adminSql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminSql.unsafe(`CREATE SCHEMA "${schema}"`);
    } finally {
      await adminSql.end();
    }
  }

  async function reset(): Promise<void> {
    // Close any cached connection bound to the old (now-dropped) schema
    // tables so the next getDb() rebuilds a fresh pool against the
    // recreated schema. Without this, pooled connections can hold stale
    // references that fail on the next query.
    await closeDb();
    await dropAndCreateSchema();
    await runMigrations(TEST_DB_URL, MIGRATIONS_DIR, { searchPath: schema });
  }

  beforeEach(reset);

  afterAll(async () => {
    await closeDb();
    const adminSql = postgres(TEST_DB_URL, { onnotice: () => {} });
    try {
      await adminSql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await adminSql.end();
    }
  });

  return {
    schema,
    url: TEST_DB_URL,
    sql: () => getDb(TEST_DB_URL, { searchPath: schema }),
    reset,
  };
}
