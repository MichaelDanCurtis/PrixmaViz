/**
 * Group F — bulk MCP tool tests.
 *
 * Covers:
 *   - 5-item batch with all valid → 5 created, 0 failed, exactly 1 broadcast
 *   - mixed batch + stopOnError:false → partial created + partial failed
 *   - mixed batch + stopOnError:true → halts on first error
 *   - slug-collision within batch → unique slugs assigned
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import type { ServerToClient } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace } from "../../../src/db/workspaces";
import { listDiagrams } from "../../../src/db/diagrams";
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

interface BroadcastEvent {
  workspaceId: string | null;
  msg: ServerToClient;
}

/**
 * Build a context whose kroki client returns an `<svg/>` placeholder so the
 * render pipeline succeeds without a real kroki sidecar. The hub records
 * every broadcast so tests can assert on broadcast counts.
 *
 * `failingEngine`, if supplied, causes the fake kroki to throw when asked
 * to render that engine — useful for `failed[]` assertions.
 */
function makeCtx(
  sql: ReturnType<typeof getDb>,
  workspaceId: string,
  opts: { failingEngine?: string } = {},
) {
  const broadcasts: BroadcastEvent[] = [];
  const ctx = {
    sql,
    workspaceId,
    kroki: {
      renderSvg: async (engine: string) => {
        if (opts.failingEngine && engine === opts.failingEngine) {
          throw new Error(`fake kroki rejected engine="${engine}"`);
        }
        return "<svg/>";
      },
      renderBinary: async () => new Uint8Array(),
    } as never,
    hub: {
      broadcast(wsId: string | null, msg: ServerToClient) {
        broadcasts.push({ workspaceId: wsId, msg });
      },
    } as never,
  };
  return { ctx, broadcasts };
}

// ───────────────────────────────────────────────────────────────────────────
// import_diagrams
// ───────────────────────────────────────────────────────────────────────────

describe("import_diagrams", () => {
  it("5-item all-valid batch → 5 created, 0 failed, exactly 1 workspace broadcast", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    const items = [
      { name: "Flow A", engine: "mermaid" as const, source: "graph TD\n  A --> B" },
      { name: "Flow B", engine: "mermaid" as const, source: "graph TD\n  C --> D" },
      { name: "Flow C", engine: "mermaid" as const, source: "graph TD\n  E --> F" },
      { name: "Flow D", engine: "mermaid" as const, source: "graph TD\n  G --> H" },
      { name: "Flow E", engine: "mermaid" as const, source: "graph TD\n  I --> J" },
    ];

    const result = (await dispatchTool(
      "import_diagrams",
      { items },
      ctx,
    )) as {
      created: Array<{ slug: string; diagramId: string; render: { svg: string } }>;
      failed: Array<{ name: string; error: string }>;
    };

    expect(result.created.length).toBe(5);
    expect(result.failed.length).toBe(0);
    // Slugs distinct.
    expect(new Set(result.created.map((c) => c.slug)).size).toBe(5);
    // Diagrams persisted.
    const rows = await listDiagrams(sql, ws.id);
    expect(rows.length).toBe(5);

    // Exactly one workspace broadcast emitted regardless of batch size.
    const workspaceBroadcasts = broadcasts.filter(
      (e) => (e.msg as { type?: string }).type === "workspace",
    );
    expect(workspaceBroadcasts.length).toBe(1);
  });

  it("mixed batch with stopOnError:false → partial created + partial failed", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Force every "plantuml" render to fail; "mermaid" succeeds.
    const { ctx, broadcasts } = makeCtx(sql, ws.id, { failingEngine: "plantuml" });

    const items = [
      { name: "ok1", engine: "mermaid" as const, source: "graph TD\n  A --> B" },
      { name: "broken1", engine: "plantuml" as const, source: "@startuml\nA -> B\n@enduml" },
      { name: "ok2", engine: "mermaid" as const, source: "graph TD\n  C --> D" },
      { name: "broken2", engine: "plantuml" as const, source: "@startuml\nC -> D\n@enduml" },
      { name: "ok3", engine: "mermaid" as const, source: "graph TD\n  E --> F" },
    ];

    const result = (await dispatchTool(
      "import_diagrams",
      { items, stopOnError: false },
      ctx,
    )) as {
      created: Array<{ slug: string }>;
      failed: Array<{ name: string; error: string }>;
    };

    expect(result.created.length).toBe(3);
    expect(result.failed.length).toBe(2);
    expect(result.failed.map((f) => f.name).sort()).toEqual(["broken1", "broken2"]);
    expect(result.failed[0]!.error).toMatch(/plantuml/);

    // Persisted exactly the 3 successful ones.
    const rows = await listDiagrams(sql, ws.id);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.name).sort()).toEqual(["ok1", "ok2", "ok3"]);

    // Still exactly one broadcast.
    const workspaceBroadcasts = broadcasts.filter(
      (e) => (e.msg as { type?: string }).type === "workspace",
    );
    expect(workspaceBroadcasts.length).toBe(1);
  });

  it("mixed batch with stopOnError:true → halts on first error and reports partial state", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id, { failingEngine: "plantuml" });

    const items = [
      { name: "first-ok", engine: "mermaid" as const, source: "graph TD\n  A --> B" },
      { name: "second-ok", engine: "mermaid" as const, source: "graph TD\n  C --> D" },
      { name: "bad", engine: "plantuml" as const, source: "@startuml\nA -> B\n@enduml" },
      { name: "skipped-1", engine: "mermaid" as const, source: "graph TD\n  E --> F" },
      { name: "skipped-2", engine: "mermaid" as const, source: "graph TD\n  G --> H" },
    ];

    const result = (await dispatchTool(
      "import_diagrams",
      { items, stopOnError: true },
      ctx,
    )) as {
      created: Array<{ slug: string }>;
      failed: Array<{ name: string; error: string }>;
    };

    expect(result.created.length).toBe(2);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]!.name).toBe("bad");

    // Items AFTER the failure were skipped — only the 2 pre-failure rows persisted.
    const rows = await listDiagrams(sql, ws.id);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["first-ok", "second-ok"]);
  });

  it("slug-collision within batch → unique slugs assigned via createDiagramWithUniqueSlug", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    // Three items with names that slugify to the same base ("same").
    const items = [
      { name: "Same", engine: "mermaid" as const, source: "graph TD\n  A --> B" },
      { name: "same", engine: "mermaid" as const, source: "graph TD\n  C --> D" },
      { name: "SAME", engine: "mermaid" as const, source: "graph TD\n  E --> F" },
    ];

    const result = (await dispatchTool(
      "import_diagrams",
      { items },
      ctx,
    )) as {
      created: Array<{ slug: string }>;
      failed: Array<{ name: string; error: string }>;
    };

    expect(result.created.length).toBe(3);
    expect(result.failed.length).toBe(0);

    // All three slugs are unique even though base slug collided.
    const slugs = result.created.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(3);
    // The first one wins the bare "same" slug; the rest get suffixes.
    expect(slugs).toContain("same");
    const suffixed = slugs.filter((s) => s !== "same");
    expect(suffixed.length).toBe(2);
    for (const s of suffixed) {
      expect(s).toMatch(/^same-/);
    }
  });

  it("tags are persisted on imported items", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const result = (await dispatchTool(
      "import_diagrams",
      {
        items: [
          {
            name: "Tagged",
            engine: "mermaid",
            source: "graph TD\n  A --> B",
            tags: ["alpha", "beta"],
          },
        ],
      },
      ctx,
    )) as { created: Array<{ slug: string; diagramId: string }>; failed: unknown[] };

    expect(result.created.length).toBe(1);
    const row = (await listDiagrams(sql, ws.id))[0]!;
    const tags = (row.meta as { tags?: string[] }).tags;
    expect(tags).toEqual(["alpha", "beta"]);
  });

  it("kind defaults to inferKind(engine) when omitted", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    // mermaid is a "graph"-family engine; omitting `kind` should yield `kind=graph`.
    const result = (await dispatchTool(
      "import_diagrams",
      {
        items: [{ name: "Graph Style", engine: "mermaid" }],
      },
      ctx,
    )) as { created: Array<{ slug: string; diagramId: string }> };

    expect(result.created.length).toBe(1);
    const row = (await listDiagrams(sql, ws.id))[0]!;
    expect(row.kind).toBe("graph");
  });

  it("missing `items` → validator rejects pre-dispatch", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    await expect(
      dispatchTool("import_diagrams", {}, ctx),
    ).rejects.toThrow(/Missing required parameter: items/);
  });

  it("malformed item shape is captured per-item, doesn't abort the batch (stopOnError:false default)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const result = (await dispatchTool(
      "import_diagrams",
      {
        items: [
          { name: "Valid", engine: "mermaid", source: "graph TD\n  A --> B" },
          { name: "" /* empty name */, engine: "mermaid" },
          { name: "Also Valid", engine: "mermaid", source: "graph TD\n  C --> D" },
        ],
      },
      ctx,
    )) as {
      created: Array<{ slug: string }>;
      failed: Array<{ name: string; error: string }>;
    };

    expect(result.created.length).toBe(2);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]!.error).toMatch(/name/);
  });
});
