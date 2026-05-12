import { describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { join } from "node:path";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

describe("runMigrations", () => {
  it("applies all migrations idempotently", async () => {
    const sql = postgres(TEST_DB_URL);
    // Drop everything to start fresh
    await sql`DROP TABLE IF EXISTS annotations CASCADE`;
    await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
    await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
    await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
    await sql.end();

    const migrationsDir = join(import.meta.dir, "../../migrations");
    await runMigrations(TEST_DB_URL, migrationsDir);

    // Verify tables exist
    const verifySql = postgres(TEST_DB_URL);
    const tables = await verifySql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    expect(tables.map((t) => t.tablename)).toEqual([
      "annotations", "diagrams", "schema_migrations", "workspaces",
    ]);

    // Run again — should be idempotent
    await runMigrations(TEST_DB_URL, migrationsDir);
    const counts = await verifySql`SELECT COUNT(*)::int as n FROM schema_migrations`;
    expect(counts[0].n).toBe(1);  // still just 0001_init.sql

    await verifySql.end();
  });
});
