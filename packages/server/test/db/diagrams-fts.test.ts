import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

describe("diagrams FTS (search_tsv generated column)", () => {
  it("ranks name matches higher than dsl-only matches (weight A > weight B)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);

    // Diagram 1: matches in name (highest weight A).
    await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "auth-flow",
      name: "Auth flow diagram",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "graph TD\n  Start --> End",
    });
    // Diagram 2: same query word appears only in DSL (weight B).
    await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "payments",
      name: "Payments overview",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "graph TD\n  User --> Auth\n  Auth --> Bank",
    });

    const rows = await sql<{ id: string; slug: string; rank: number }[]>`
      SELECT id, slug, ts_rank(search_tsv, q) AS rank
      FROM diagrams, to_tsquery('english', 'auth') q
      WHERE workspace_id = ${ws.id}
        AND search_tsv @@ q
      ORDER BY rank DESC
    `;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.slug).toBe("auth-flow"); // name match outranks DSL match
    expect(rows[1]?.slug).toBe("payments");
    expect(Number(rows[0]?.rank)).toBeGreaterThan(Number(rows[1]?.rank));
  });

  it("filters out rows that don't match the query at all", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);

    await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "alpha",
      name: "alpha widget",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "graph TD\n  A --> B",
    });
    await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "beta",
      name: "beta gadget",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "graph TD\n  C --> D",
    });

    const rows = await sql`
      SELECT slug FROM diagrams
      WHERE workspace_id = ${ws.id}
        AND search_tsv @@ to_tsquery('english', 'gadget')
    `;
    expect(rows.map((r) => r.slug)).toEqual(["beta"]);
  });

  it("ts_headline returns a snippet around the matched term", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);

    await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "with-snippet",
      name: "Long doc",
      engine: "mermaid",
      kind: "passthrough",
      dsl:
        "graph TD\n" +
        "  Login --> CheckCredentials\n" +
        "  CheckCredentials --> EnableEntities\n" +
        "  EnableEntities --> ServiceDispatch\n" +
        "  ServiceDispatch --> Done",
    });

    const rows = await sql<{ snippet: string }[]>`
      SELECT ts_headline('english', dsl, to_tsquery('english', 'enableEntities')) AS snippet
      FROM diagrams
      WHERE workspace_id = ${ws.id}
        AND search_tsv @@ to_tsquery('english', 'enableEntities')
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.snippet).toMatch(/EnableEntities/);
    // ts_headline wraps the match in <b>…</b> by default.
    expect(rows[0]?.snippet).toMatch(/<b>/);
  });

  it("works alongside the meta->'tags' containment filter (the new GIN index)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);

    const d1 = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "tagged-auth",
      name: "tagged auth",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "graph TD\n  X --> Y",
    });
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["security", "auth"] })} WHERE id = ${d1.id}`;

    await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "untagged",
      name: "untagged",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "graph TD\n  Foo --> Bar",
    });

    const rows = await sql`
      SELECT slug FROM diagrams
      WHERE workspace_id = ${ws.id}
        AND meta -> 'tags' @> ${sql.json(["security"])}::jsonb
    `;
    expect(rows.map((r) => r.slug)).toEqual(["tagged-auth"]);
  });

  it("search_tsv updates automatically when name or dsl changes (it's a generated column)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);

    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "evolving",
      name: "original",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "graph TD\n  X --> Y",
    });

    // Update name → "renamed" — search_tsv must reflect that.
    await sql`UPDATE diagrams SET name = 'renamed', updated_at = now() WHERE id = ${d.id}`;
    const renamed = await sql`
      SELECT slug FROM diagrams
      WHERE workspace_id = ${ws.id} AND search_tsv @@ to_tsquery('english', 'renamed')
    `;
    expect(renamed.map((r) => r.slug)).toEqual(["evolving"]);
    const original = await sql`
      SELECT slug FROM diagrams
      WHERE workspace_id = ${ws.id} AND search_tsv @@ to_tsquery('english', 'original')
    `;
    expect(original).toHaveLength(0);
  });
});
