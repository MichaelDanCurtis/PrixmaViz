import { describe, expect, it } from "bun:test";
import { getDb, closeDb } from "../../src/db/client";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

describe("db client", () => {
  it("getDb returns a postgres connection that runs a basic query", async () => {
    const sql = getDb(TEST_DB_URL);
    const result = await sql`SELECT 1 as one`;
    expect(result[0].one).toBe(1);
    await closeDb();
  });

  it("getDb returns the same instance on subsequent calls", () => {
    const a = getDb(TEST_DB_URL);
    const b = getDb(TEST_DB_URL);
    expect(a).toBe(b);
    closeDb();
  });
});
