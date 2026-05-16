import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { emptyGraphIR, type Tile } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace, updateWorkspaceTiles } from "../../../src/db/workspaces";
import { createDiagram, updateDiagram } from "../../../src/db/diagrams";
import { dispatchTool } from "../../../src/mcp/tools";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

// Static stub returned by the mocked kroki client. The list_tiles tests
// don't actually need rendering; the stub keeps the ctx factory shape the
// same across all canvas tests so subsequent commits don't need to rewrite
// the helper.
const STUB_TILE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">` +
  `<g id="root"><rect id="r1" x="0" y="0" width="100" height="80" fill="red"/></g>` +
  `</svg>`;

interface BroadcastEvent {
  workspaceId: string | null;
  msg: { type?: string; [k: string]: unknown };
}

function makeCtx(sql: ReturnType<typeof getDb>, workspaceId: string) {
  const broadcasts: BroadcastEvent[] = [];
  const ctx = {
    sql,
    workspaceId,
    kroki: {
      renderSvg: async () => STUB_TILE_SVG,
      renderBinary: async () => new TextEncoder().encode(STUB_TILE_SVG),
    } as never,
    hub: {
      broadcast(wsId: string | null, msg: BroadcastEvent["msg"]) {
        broadcasts.push({ workspaceId: wsId, msg });
      },
    } as never,
  };
  return { ctx, broadcasts };
}

// Seed a tile referencing a real diagram so workspace.tiles JSON has a row
// pointing at a valid diagram_id. Defaults to a pre-cached SVG so future
// snapshot tests don't trigger render-on-miss unless they want to.
async function seedTile(
  sql: ReturnType<typeof getDb>,
  workspaceId: string,
  tile: Omit<Tile, "id" | "diagramId" | "diagramSlug"> & { id?: string; slug?: string; name?: string; svg?: string | null; focused?: boolean },
): Promise<Tile> {
  const slug = tile.slug ?? `d-${Math.random().toString(36).slice(2, 8)}`;
  const d = await createDiagram(sql, {
    workspaceId,
    slug,
    name: tile.name ?? slug,
    engine: "mermaid",
    kind: "graph",
    ir: emptyGraphIR(),
  });
  if (tile.svg !== undefined) {
    if (tile.svg !== null) {
      await updateDiagram(sql, workspaceId, d.id, { svg: tile.svg });
    }
  } else {
    await updateDiagram(sql, workspaceId, d.id, { svg: STUB_TILE_SVG });
  }
  return {
    id: tile.id ?? `t_${Math.random().toString(36).slice(2, 8)}`,
    diagramId: d.id,
    diagramSlug: d.slug,
    x: tile.x,
    y: tile.y,
    w: tile.w,
    h: tile.h,
    z: tile.z,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// list_tiles
// ───────────────────────────────────────────────────────────────────────────

describe("MCP list_tiles", () => {
  it("returns all tiles with geometry + diagram refs", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const t1 = await seedTile(sql, ws.id, { id: "t_one", slug: "one", x: 0, y: 0, w: 100, h: 80, z: 1 });
    const t2 = await seedTile(sql, ws.id, { id: "t_two", slug: "two", x: 200, y: 50, w: 60, h: 40, z: 2 });
    await updateWorkspaceTiles(sql, ws.id, [t1, t2]);

    const out = (await dispatchTool("list_tiles", {}, ctx)) as {
      tiles: Array<{ id: string; diagramSlug: string; x: number; y: number; w: number; h: number; z: number; focused?: boolean }>;
    };
    expect(out.tiles.length).toBe(2);
    const byId = new Map(out.tiles.map((t) => [t.id, t]));
    expect(byId.get("t_one")).toMatchObject({ x: 0, y: 0, w: 100, h: 80, z: 1, diagramSlug: "one" });
    expect(byId.get("t_two")).toMatchObject({ x: 200, y: 50, w: 60, h: 40, z: 2, diagramSlug: "two" });
    // Neither tile carries focused=true.
    expect(out.tiles.every((t) => t.focused === undefined)).toBe(true);
  });

  it("sets focused: true on the focused tile, omits the flag on others", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const t1 = await seedTile(sql, ws.id, { id: "t_a", slug: "a", x: 0, y: 0, w: 100, h: 80, z: 1 });
    const t2 = await seedTile(sql, ws.id, { id: "t_b", slug: "b", x: 200, y: 50, w: 60, h: 40, z: 2 });
    // Persist focused flag directly on tile 2.
    await updateWorkspaceTiles(sql, ws.id, [t1, { ...t2, focused: true } as Tile & { focused: true }]);

    const out = (await dispatchTool("list_tiles", {}, ctx)) as {
      tiles: Array<{ id: string; focused?: boolean }>;
    };
    const focused = out.tiles.filter((t) => t.focused === true);
    expect(focused.length).toBe(1);
    expect(focused[0]!.id).toBe("t_b");
    // The other tile must not carry `focused: false` — the spec is opt-in.
    const other = out.tiles.find((t) => t.id === "t_a")!;
    expect(other.focused).toBeUndefined();
  });

  it("returns { tiles: [] } for an empty workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    const out = (await dispatchTool("list_tiles", {}, ctx)) as { tiles: unknown[] };
    expect(out.tiles).toEqual([]);
  });
});
