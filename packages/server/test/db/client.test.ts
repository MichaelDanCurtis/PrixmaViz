import { afterEach, describe, expect, it } from "bun:test";
import { getDb, closeDb } from "../../src/db/client";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

describe("db client", () => {
  afterEach(closeDb);

  it("getDb returns a postgres connection that runs a basic query", async () => {
    const sql = getDb(TEST_DB_URL);
    const result = await sql`SELECT 1 as one`;
    expect(result[0].one).toBe(1);
  });

  it("getDb returns the same instance on subsequent calls", () => {
    const a = getDb(TEST_DB_URL);
    const b = getDb(TEST_DB_URL);
    expect(a).toBe(b);
  });

  it("getDb returns a different instance when URL changes", () => {
    const a = getDb(TEST_DB_URL);
    const b = getDb(TEST_DB_URL.replace("/prixmaviz_test", "/prixmaviz_other"));
    expect(a).not.toBe(b);
  });

  it("getDb returns a different instance when searchPath changes", () => {
    const a = getDb(TEST_DB_URL, { searchPath: "test_a" });
    const b = getDb(TEST_DB_URL, { searchPath: "test_b" });
    expect(a).not.toBe(b);
  });

  it("getDb applies search_path on connections when supplied", async () => {
    const sql = getDb(TEST_DB_URL, { searchPath: "pg_temp" });
    const r = await sql`SHOW search_path`;
    expect(r[0]!.search_path).toBe("pg_temp");
  });
});
