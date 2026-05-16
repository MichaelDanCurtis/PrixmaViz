/**
 * Tests for Group B (Issue #5, Wave 2): search_diagrams.
 *
 * Separate from the other tools/ tests so a regression in one tool can't
 * mask a regression in another. Mirrors the file-per-group convention
 * already used for `crud.test.ts` and `annotations.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import type { ServerToClient } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace } from "../../../src/db/workspaces";
import { addAnnotation } from "../../../src/db/annotations";
import { createDiagram, updateDiagram } from "../../../src/db/diagrams";
import { dispatchTool } from "../../../src/mcp/tools";

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
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

// ───────────────────────────────────────────────────────────────────────────
// Test helpers
// ───────────────────────────────────────────────────────────────────────────

interface BroadcastEvent {
  workspaceId: string | null;
  msg: ServerToClient;
}

/**
 * Builds a tool context with a recording WS hub and a no-op Kroki stub.
 */
function makeCtx(sql: ReturnType<typeof getDb>, workspaceId: string) {
  const broadcasts: BroadcastEvent[] = [];
  const ctx = {
    sql,
    workspaceId,
    kroki: { renderSvg: async () => "<svg/>" } as never,
    hub: {
      broadcast(wsId: string | null, msg: ServerToClient) {
        broadcasts.push({ workspaceId: wsId, msg });
      },
    } as never,
  };
  return { ctx, broadcasts };
}

// ───────────────────────────────────────────────────────────────────────────
// search_diagrams
// ───────────────────────────────────────────────────────────────────────────

describe("search_diagrams", () => {
  it("matches a word that only appears in the DSL (FTS over name + dsl)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    await createDiagram(sql, {
      workspaceId: ws.id, slug: "alpha", name: "alpha widget",
      engine: "mermaid", kind: "passthrough",
      dsl: "graph TD\n  Start --> EnableEntities\n  EnableEntities --> End",
    });
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "beta", name: "beta gadget",
      engine: "mermaid", kind: "passthrough",
      dsl: "graph TD\n  A --> B",
    });

    const result = (await dispatchTool(
      "search_diagrams",
      { query: "enableEntities" },
      ctx,
    )) as { results: Array<{ slug: string; snippet?: string }> };

    expect(result.results.length).toBe(1);
    expect(result.results[0]?.slug).toBe("alpha");
  });

  it("returns a snippet around the matched term when a query is supplied", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    await createDiagram(sql, {
      workspaceId: ws.id, slug: "with-snippet", name: "Long doc",
      engine: "mermaid", kind: "passthrough",
      dsl:
        "graph TD\n" +
        "  Login --> CheckCredentials\n" +
        "  CheckCredentials --> EnableEntities\n" +
        "  EnableEntities --> ServiceDispatch\n" +
        "  ServiceDispatch --> Done",
    });

    const result = (await dispatchTool(
      "search_diagrams",
      { query: "enableEntities" },
      ctx,
    )) as { results: Array<{ slug: string; snippet?: string }> };

    expect(result.results.length).toBe(1);
    expect(result.results[0]?.snippet).toBeDefined();
    // ts_headline wraps matches in <b>…</b>; the snippet must contain the term.
    expect(result.results[0]?.snippet?.toLowerCase()).toContain("enableentities");
  });

  it("ranks name matches above dsl-only matches (relevance sort default)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    // Name match — weight A in the generated tsvector.
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "auth-flow", name: "Auth flow diagram",
      engine: "mermaid", kind: "passthrough",
      dsl: "graph TD\n  Start --> End",
    });
    // DSL-only match — weight B.
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "payments", name: "Payments overview",
      engine: "mermaid", kind: "passthrough",
      dsl: "graph TD\n  User --> Auth\n  Auth --> Bank",
    });

    const result = (await dispatchTool(
      "search_diagrams",
      { query: "auth" },
      ctx,
    )) as { results: Array<{ slug: string; score?: number }> };

    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.results[0]?.slug).toBe("auth-flow");
    expect(result.results[1]?.slug).toBe("payments");
    // Score is decreasing across hits.
    expect(result.results[0]?.score ?? 0).toBeGreaterThan(result.results[1]?.score ?? 0);
  });

  it("matches a word in an annotation body (annotation-search EXISTS path)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "annotated", name: "annotated",
      engine: "mermaid", kind: "passthrough",
      dsl: "graph TD\n  X --> Y",
    });
    await addAnnotation(sql, d.id, {
      id: "ann_1", kind: "comment",
      text: "this needs zebrafish review", createdAt: new Date().toISOString(),
    } as never);

    const result = (await dispatchTool(
      "search_diagrams",
      { query: "zebrafish" },
      ctx,
    )) as { results: Array<{ slug: string }> };

    expect(result.results.map((r) => r.slug)).toEqual(["annotated"]);
  });

  it("tag filter is AND across all supplied tags (jsonb @> containment)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const d1 = await createDiagram(sql, {
      workspaceId: ws.id, slug: "both", name: "Both",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  X --> Y",
    });
    await updateDiagram(sql, ws.id, d1.id, { meta: { tags: ["mercury", "auth"] } });

    const d2 = await createDiagram(sql, {
      workspaceId: ws.id, slug: "just-mercury", name: "Just Mercury",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  A --> B",
    });
    await updateDiagram(sql, ws.id, d2.id, { meta: { tags: ["mercury"] } });

    const d3 = await createDiagram(sql, {
      workspaceId: ws.id, slug: "just-auth", name: "Just Auth",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  C --> D",
    });
    await updateDiagram(sql, ws.id, d3.id, { meta: { tags: ["auth"] } });

    const result = (await dispatchTool(
      "search_diagrams",
      { tags: ["mercury", "auth"] },
      ctx,
    )) as { results: Array<{ slug: string }> };

    // AND semantics: only "both" has both tags.
    expect(result.results.map((r) => r.slug)).toEqual(["both"]);
  });

  it("engine filter accepts a list (engine = ANY(...))", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "M",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  A --> B",
    });
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "g", name: "G",
      engine: "graphviz", kind: "passthrough", dsl: "digraph { a -> b }",
    });
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "p", name: "P",
      engine: "plantuml", kind: "passthrough", dsl: "@startuml\nA -> B\n@enduml",
    });

    const result = (await dispatchTool(
      "search_diagrams",
      { engines: ["mermaid", "graphviz"] },
      ctx,
    )) as { results: Array<{ slug: string; engine: string }> };

    const slugs = result.results.map((r) => r.slug).sort();
    expect(slugs).toEqual(["g", "m"]);
    expect(result.results.every((r) => ["mermaid", "graphviz"].includes(r.engine))).toBe(true);
  });

  it("updatedSince filters by updated_at >= the provided timestamp", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const old = await createDiagram(sql, {
      workspaceId: ws.id, slug: "old", name: "Old",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  A --> B",
    });
    // Backdate the old diagram so the filter excludes it.
    await sql`UPDATE diagrams SET updated_at = now() - interval '7 days' WHERE id = ${old.id}`;

    await createDiagram(sql, {
      workspaceId: ws.id, slug: "new", name: "New",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  C --> D",
    });

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = (await dispatchTool(
      "search_diagrams",
      { updatedSince: cutoff },
      ctx,
    )) as { results: Array<{ slug: string }> };

    expect(result.results.map((r) => r.slug)).toEqual(["new"]);
  });

  it("empty query + filters returns the filtered list (no relevance scoring)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const d1 = await createDiagram(sql, {
      workspaceId: ws.id, slug: "a", name: "A",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  X --> Y",
    });
    await updateDiagram(sql, ws.id, d1.id, { meta: { tags: ["docs"] } });

    await createDiagram(sql, {
      workspaceId: ws.id, slug: "b", name: "B",
      engine: "graphviz", kind: "passthrough", dsl: "digraph { x -> y }",
    });

    const result = (await dispatchTool(
      "search_diagrams",
      { tags: ["docs"] },
      ctx,
    )) as { results: Array<{ slug: string; score?: number; snippet?: string }> };

    expect(result.results.map((r) => r.slug)).toEqual(["a"]);
    // No query → no snippet, no score.
    expect(result.results[0]?.snippet).toBeUndefined();
    expect(result.results[0]?.score).toBeUndefined();
  });

  it("respects sort: 'name' (alphabetical ASC)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    await createDiagram(sql, {
      workspaceId: ws.id, slug: "z", name: "Zebra",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  A --> B",
    });
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "a", name: "Apple",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  C --> D",
    });
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "Mango",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  E --> F",
    });

    const result = (await dispatchTool(
      "search_diagrams",
      { sort: "name" },
      ctx,
    )) as { results: Array<{ name: string }> };

    expect(result.results.map((r) => r.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("clamps limit to [1, 100] and defaults to 20", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    // 25 diagrams.
    for (let i = 0; i < 25; i++) {
      await createDiagram(sql, {
        workspaceId: ws.id, slug: `d-${i}`, name: `D ${i}`,
        engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  A --> B",
      });
    }

    // Default limit (20).
    const defaultRes = (await dispatchTool(
      "search_diagrams",
      {},
      ctx,
    )) as { results: unknown[] };
    expect(defaultRes.results.length).toBe(20);

    // Explicit limit 5.
    const limitedRes = (await dispatchTool(
      "search_diagrams",
      { limit: 5 },
      ctx,
    )) as { results: unknown[] };
    expect(limitedRes.results.length).toBe(5);

    // limit beyond max — capped at 100 (we only have 25, so capped by data).
    const bigRes = (await dispatchTool(
      "search_diagrams",
      { limit: 9999 },
      ctx,
    )) as { results: unknown[] };
    expect(bigRes.results.length).toBe(25);
  });

  it("only returns diagrams from the caller's workspace (no cross-tenant leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);

    await createDiagram(sql, {
      workspaceId: wsA.id, slug: "private-a", name: "secret",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  Alpha --> Beta",
    });
    await createDiagram(sql, {
      workspaceId: wsB.id, slug: "private-b", name: "secret",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  Gamma --> Delta",
    });

    const { ctx: ctxA } = makeCtx(sql, wsA.id);
    const aResult = (await dispatchTool(
      "search_diagrams",
      { query: "secret" },
      ctxA,
    )) as { results: Array<{ slug: string }> };
    expect(aResult.results.map((r) => r.slug)).toEqual(["private-a"]);
  });

  it("returns an empty results array when nothing matches", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    await createDiagram(sql, {
      workspaceId: ws.id, slug: "x", name: "X",
      engine: "mermaid", kind: "passthrough", dsl: "graph TD\n  A --> B",
    });

    const result = (await dispatchTool(
      "search_diagrams",
      { query: "qzzxqzzx_no_such_word" },
      ctx,
    )) as { results: unknown[] };

    expect(result.results).toEqual([]);
  });
});
