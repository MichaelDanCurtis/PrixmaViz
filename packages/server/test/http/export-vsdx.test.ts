import { describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { handleApi } from "../../src/http/routes";
import { buildBasicFlowchartFixture } from "../fixtures/vsdx/build-fixture";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

const fakeHub = { broadcast: () => {} } as never;
const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

describe("GET /api/diagrams/:id/export.vsdx", () => {
  it("returns stored bytes verbatim for vsdx-engine diagrams", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const original = await buildBasicFlowchartFixture();
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "x", name: "X",
      engine: "vsdx", kind: "binary", bytes: original,
    });
    const req = new Request(`http://x/api/diagrams/${d.id}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("application/vnd.ms-visio.drawing");
    const got = new Uint8Array(await res!.arrayBuffer());
    expect(got.length).toBe(original.length);
    expect(got[0]).toBe(0x50);
    for (let i = 0; i < Math.min(100, original.length); i++) {
      expect(got[i]).toBe(original[i]);
    }
  });

  it("produces a structured vsdx for a Mermaid graph diagram", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "M",
      engine: "mermaid", kind: "graph",
      ir: {
        layout: { direction: "TB" },
        nodes: { a: { id: "a", label: "A", shape: "rect" } },
        edges: {},
        groups: {},
      },
    });
    const req = new Request(`http://x/api/diagrams/${d.id}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    const got = new Uint8Array(await res!.arrayBuffer());
    expect(got[0]).toBe(0x50);
  });

  it("404 for non-existent diagram", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const req = new Request(`http://x/api/diagrams/nope/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(404);
  });
});
