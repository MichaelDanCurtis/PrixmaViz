import { describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { handleApi, type RouteDeps } from "../../src/http/routes";
import { KrokiClient } from "../../src/kroki/client";
import { WsHub } from "../../src/ws/broadcast";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

function makeDeps(): RouteDeps {
  return {
    sql: db.sql(),
    kroki: new KrokiClient(),
    hub: new WsHub(),
  };
}

async function postTile(
  deps: RouteDeps,
  workspaceId: string,
  body: { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number },
): Promise<{ tile: { id: string; diagramSlug: string }; existing?: boolean }> {
  const req = new Request("http://x/api/tiles", {
    method: "POST",
    headers: { Authorization: `Bearer ${workspaceId}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const resp = await handleApi(req, new URL(req.url), deps);
  expect(resp?.status).toBe(200);
  return await resp!.json();
}

describe("POST /api/tiles dedup (issue #3, part B)", () => {
  it("creates a tile on the first POST for a given diagramSlug", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "alpha", name: "Alpha", engine: "mermaid", kind: "graph",
    });
    const deps = makeDeps();

    const first = await postTile(deps, ws.id, { diagramId: d.id, diagramSlug: "alpha", x: 100, y: 100 });
    expect(first.existing).toBeUndefined();
    expect(first.tile.diagramSlug).toBe("alpha");

    // Verify the tile actually landed in ws.tiles.
    const getReq = new Request("http://x/api/workspace", {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const getResp = await handleApi(getReq, new URL(getReq.url), deps);
    const fetched = await getResp!.json();
    expect(fetched.tiles.length).toBe(1);
    expect(fetched.tiles[0].diagramSlug).toBe("alpha");
  });

  it("returns the existing tile with existing:true on a second POST for the same diagramSlug, and does NOT append", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "alpha", name: "Alpha", engine: "mermaid", kind: "graph",
    });
    const deps = makeDeps();

    const first = await postTile(deps, ws.id, { diagramId: d.id, diagramSlug: "alpha", x: 100, y: 100 });
    const firstId = first.tile.id;

    const second = await postTile(deps, ws.id, { diagramId: d.id, diagramSlug: "alpha", x: 500, y: 500 });
    expect(second.existing).toBe(true);
    expect(second.tile.id).toBe(firstId); // same tile, not a new one

    // ws.tiles should still have exactly one tile.
    const getReq = new Request("http://x/api/workspace", {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const getResp = await handleApi(getReq, new URL(getReq.url), deps);
    const fetched = await getResp!.json();
    expect(fetched.tiles.length).toBe(1);
    expect(fetched.tiles[0].id).toBe(firstId);
  });

  it("still creates a second tile when diagramSlug differs", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const da = await createDiagram(sql, {
      workspaceId: ws.id, slug: "alpha", name: "Alpha", engine: "mermaid", kind: "graph",
    });
    const db2 = await createDiagram(sql, {
      workspaceId: ws.id, slug: "beta", name: "Beta", engine: "mermaid", kind: "graph",
    });
    const deps = makeDeps();

    const first = await postTile(deps, ws.id, { diagramId: da.id, diagramSlug: "alpha" });
    const second = await postTile(deps, ws.id, { diagramId: db2.id, diagramSlug: "beta" });

    expect(first.existing).toBeUndefined();
    expect(second.existing).toBeUndefined();
    expect(first.tile.id).not.toBe(second.tile.id);

    const getReq = new Request("http://x/api/workspace", {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const getResp = await handleApi(getReq, new URL(getReq.url), deps);
    const fetched = await getResp!.json();
    expect(fetched.tiles.length).toBe(2);
    const slugs = fetched.tiles.map((t: { diagramSlug: string }) => t.diagramSlug).sort();
    expect(slugs).toEqual(["alpha", "beta"]);
  });

  it("dedup is per-workspace: same slug in two workspaces creates a tile in each", async () => {
    const sql = db.sql();
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await createDiagram(sql, {
      workspaceId: wsA.id, slug: "alpha", name: "Alpha A", engine: "mermaid", kind: "graph",
    });
    const dB = await createDiagram(sql, {
      workspaceId: wsB.id, slug: "alpha", name: "Alpha B", engine: "mermaid", kind: "graph",
    });
    const deps = makeDeps();

    const a = await postTile(deps, wsA.id, { diagramId: dA.id, diagramSlug: "alpha" });
    const b = await postTile(deps, wsB.id, { diagramId: dB.id, diagramSlug: "alpha" });

    // Neither should be marked existing — they're in different workspaces.
    expect(a.existing).toBeUndefined();
    expect(b.existing).toBeUndefined();
    expect(a.tile.id).not.toBe(b.tile.id);
  });
});
