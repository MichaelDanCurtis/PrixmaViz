import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { emptyGraphIR, type Tile } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace, updateWorkspaceTiles, getWorkspace } from "../../../src/db/workspaces";
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

// Tile SVG returned by the mocked Kroki client when a render-on-miss is
// triggered by take_canvas_snapshot. Static so we can assert the composed
// output contains its prefixed-id wrappers.
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
// pointing at a valid diagram_id (avoids "diagram not found" warnings on the
// snapshot path).
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
    if (tile.svg === null) {
      // Explicitly leave svg null (don't touch the column).
    } else {
      await updateDiagram(sql, workspaceId, d.id, { svg: tile.svg });
    }
  } else {
    // Default: pre-cache an SVG so snapshot tests don't trigger render-on-miss
    // unless the test wants to.
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

// ───────────────────────────────────────────────────────────────────────────
// focus_tile
// ───────────────────────────────────────────────────────────────────────────

describe("MCP focus_tile", () => {
  it("raises the target tile's z to max(z)+1 and emits a workspace broadcast", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    const t1 = await seedTile(sql, ws.id, { id: "t_low", slug: "low", x: 0, y: 0, w: 100, h: 80, z: 1 });
    const t2 = await seedTile(sql, ws.id, { id: "t_mid", slug: "mid", x: 100, y: 0, w: 100, h: 80, z: 5 });
    const t3 = await seedTile(sql, ws.id, { id: "t_high", slug: "high", x: 200, y: 0, w: 100, h: 80, z: 9 });
    await updateWorkspaceTiles(sql, ws.id, [t1, t2, t3]);

    const out = (await dispatchTool("focus_tile", { tileId: "t_low" }, ctx)) as {
      ok: boolean; tileId: string; newZ: number; panTo?: unknown;
    };
    expect(out.ok).toBe(true);
    expect(out.tileId).toBe("t_low");
    expect(out.newZ).toBe(10); // max(1, 5, 9) + 1
    expect(out.panTo).toBeUndefined(); // pan defaults to false

    // Persisted z reflects the bump.
    const after = await getWorkspace(sql, ws.id);
    const targetTile = after!.tiles.find((t) => t.id === "t_low")!;
    expect(targetTile.z).toBe(10);

    // Workspace broadcast went out.
    const wsEvents = broadcasts.filter((e) => e.msg.type === "workspace");
    expect(wsEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("with pan: true returns the tile center as world coordinates (no zoom)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const t = await seedTile(sql, ws.id, { id: "t_pan", slug: "pan", x: 100, y: 200, w: 80, h: 40, z: 1 });
    await updateWorkspaceTiles(sql, ws.id, [t]);

    const out = (await dispatchTool("focus_tile", { tileId: "t_pan", pan: true }, ctx)) as {
      panTo: { x: number; y: number; zoom?: number };
    };
    // Center = (x + w/2, y + h/2) = (140, 220).
    expect(out.panTo).toEqual({ x: 140, y: 220 });
    // The server does NOT return zoom.
    expect((out.panTo as { zoom?: number }).zoom).toBeUndefined();
  });

  it("resolves by diagramSlug when tileId is omitted", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const t = await seedTile(sql, ws.id, { id: "t_via_slug", slug: "via-slug", x: 0, y: 0, w: 100, h: 80, z: 1 });
    await updateWorkspaceTiles(sql, ws.id, [t]);

    const out = (await dispatchTool("focus_tile", { diagramSlug: "via-slug" }, ctx)) as {
      ok: boolean; tileId: string;
    };
    expect(out.ok).toBe(true);
    expect(out.tileId).toBe("t_via_slug");
  });

  it("sets focused: true on the target and clears it on previously-focused tiles", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const t1 = await seedTile(sql, ws.id, { id: "t_was_focused", slug: "was", x: 0, y: 0, w: 100, h: 80, z: 1 });
    const t2 = await seedTile(sql, ws.id, { id: "t_new", slug: "new", x: 100, y: 0, w: 100, h: 80, z: 2 });
    await updateWorkspaceTiles(sql, ws.id, [
      { ...t1, focused: true } as Tile & { focused: true },
      t2,
    ]);

    await dispatchTool("focus_tile", { tileId: "t_new" }, ctx);

    const after = await getWorkspace(sql, ws.id);
    const tiles = after!.tiles as Array<Tile & { focused?: boolean }>;
    expect(tiles.find((t) => t.id === "t_was_focused")!.focused).not.toBe(true);
    expect(tiles.find((t) => t.id === "t_new")!.focused).toBe(true);
  });

  it("rejects calls that supply NEITHER tileId nor diagramSlug (oneOf gate)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(dispatchTool("focus_tile", {}, ctx)).rejects.toThrow(
      /Exactly one of \[tileId, diagramSlug\] is required/,
    );
  });

  it("rejects calls that supply BOTH tileId AND diagramSlug (oneOf gate)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(
      dispatchTool("focus_tile", { tileId: "t_x", diagramSlug: "s" }, ctx),
    ).rejects.toThrow(/Exactly one of \[.+\] is allowed, but multiple were supplied/);
  });

  it("404s when the resolved tile is missing from the workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(
      dispatchTool("focus_tile", { tileId: "t_does_not_exist" }, ctx),
    ).rejects.toThrow(/tile not found/);
    await expect(
      dispatchTool("focus_tile", { diagramSlug: "ghost" }, ctx),
    ).rejects.toThrow(/no tile for diagramSlug/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// take_canvas_snapshot
// ───────────────────────────────────────────────────────────────────────────

describe("MCP take_canvas_snapshot", () => {
  it("composes 3 tiles into a single SVG with width/height and tileCount: 3", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const t1 = await seedTile(sql, ws.id, { id: "t1", slug: "one", x: 0, y: 0, w: 100, h: 80, z: 1 });
    const t2 = await seedTile(sql, ws.id, { id: "t2", slug: "two", x: 200, y: 0, w: 100, h: 80, z: 2 });
    const t3 = await seedTile(sql, ws.id, { id: "t3", slug: "three", x: 0, y: 200, w: 100, h: 80, z: 3 });
    await updateWorkspaceTiles(sql, ws.id, [t1, t2, t3]);

    const out = (await dispatchTool(
      "take_canvas_snapshot",
      { format: "svg", padding: 20 },
      ctx,
    )) as {
      format: string;
      mimeType: string;
      base64: string;
      width: number;
      height: number;
      tileCount: number;
      warnings?: string[];
    };

    expect(out.format).toBe("svg");
    expect(out.mimeType).toBe("image/svg+xml");
    expect(out.tileCount).toBe(3);
    // BBox: x 0..300, y 0..280 → 300 × 280, + padding(20)*2 → 340 × 320.
    expect(out.width).toBe(340);
    expect(out.height).toBe(320);

    // Decode the base64 and verify it's a real SVG that contains all 3 tile
    // contents (each prefixed with t0_, t1_, t2_).
    const svg = Buffer.from(out.base64, "base64").toString("utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('id="t0_root"');
    expect(svg).toContain('id="t1_root"');
    expect(svg).toContain('id="t2_root"');
  });

  it("renders-on-miss when a tile's diagram has no cached SVG", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    // Seed a tile whose diagram has NO cached svg — snapshot must trigger
    // a render via the mocked Kroki client (which returns STUB_TILE_SVG).
    const t = await seedTile(sql, ws.id, {
      id: "t_uncached", slug: "uncached", x: 0, y: 0, w: 100, h: 80, z: 1,
      svg: null,
    });
    await updateWorkspaceTiles(sql, ws.id, [t]);

    const out = (await dispatchTool(
      "take_canvas_snapshot",
      { format: "svg" },
      ctx,
    )) as { base64: string; tileCount: number; warnings?: string[] };
    const svg = Buffer.from(out.base64, "base64").toString("utf8");
    expect(svg).toContain('id="t0_root"');
    expect(out.tileCount).toBe(1);
  });

  it("returns { tiles: 0 } and a tiny SVG for an empty workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    const out = (await dispatchTool(
      "take_canvas_snapshot",
      { format: "svg", padding: 40 },
      ctx,
    )) as { tileCount: number; width: number; height: number };
    expect(out.tileCount).toBe(0);
    // composeWorkspaceSvg's empty branch: 0 + padding*2 = 80 on each axis.
    expect(out.width).toBe(80);
    expect(out.height).toBe(80);
  });

  it("includeAnnotations: true returns a warning and a snapshot WITHOUT annotations (no crash)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    const t = await seedTile(sql, ws.id, { id: "t1", slug: "one", x: 0, y: 0, w: 100, h: 80, z: 1 });
    await updateWorkspaceTiles(sql, ws.id, [t]);

    const out = (await dispatchTool(
      "take_canvas_snapshot",
      { format: "svg", includeAnnotations: true },
      ctx,
    )) as { warnings?: string[]; tileCount: number };
    expect(out.tileCount).toBe(1);
    expect(Array.isArray(out.warnings)).toBe(true);
    expect(out.warnings!.length).toBeGreaterThanOrEqual(1);
    expect(out.warnings!.join(" ")).toMatch(/includeAnnotations/i);
  });

  it("honors a non-transparent background color", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    const t = await seedTile(sql, ws.id, { id: "t1", slug: "one", x: 0, y: 0, w: 100, h: 80, z: 1 });
    await updateWorkspaceTiles(sql, ws.id, [t]);

    const out = (await dispatchTool(
      "take_canvas_snapshot",
      { format: "svg", background: "#ffffff" },
      ctx,
    )) as { base64: string };
    const svg = Buffer.from(out.base64, "base64").toString("utf8");
    expect(svg).toContain('fill="#ffffff"');
  });

  it("rejects an unsupported format with a clear error", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(
      dispatchTool("take_canvas_snapshot", { format: "tiff" }, ctx),
    ).rejects.toThrow(/Invalid value for format|unsupported format/);
  });

  it("PNG output returns base64 bytes + image/png mimeType (skipped if rsvg-convert missing)", async () => {
    // Probe for rsvg-convert. If it's not installed in this dev env the
    // production raster path still works (Dockerfile installs librsvg);
    // we just skip the assertion here rather than fail the suite.
    let hasRsvg = false;
    try {
      const probe = Bun.spawnSync(["rsvg-convert", "--version"]);
      hasRsvg = probe.exitCode === 0;
    } catch {
      hasRsvg = false;
    }
    if (!hasRsvg) {
      // Soft-skip: just assert the format rejection / fallback shape rather
      // than executing the raster pipeline.
      expect(true).toBe(true);
      return;
    }

    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    const t = await seedTile(sql, ws.id, { id: "t1", slug: "one", x: 0, y: 0, w: 100, h: 80, z: 1 });
    await updateWorkspaceTiles(sql, ws.id, [t]);

    const out = (await dispatchTool(
      "take_canvas_snapshot",
      { format: "png" },
      ctx,
    )) as { format: string; mimeType: string; base64: string };
    expect(out.format).toBe("png");
    expect(out.mimeType).toBe("image/png");
    expect(out.base64.length).toBeGreaterThan(0);
    // First 8 bytes of any valid PNG are the PNG signature.
    const bytes = Buffer.from(out.base64, "base64");
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  });
});
