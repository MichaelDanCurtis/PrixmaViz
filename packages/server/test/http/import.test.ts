import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { handleApi } from "../../src/http/routes";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

const fakeHub = { broadcast: () => {} } as never;
const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

const VSDX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

beforeEach(() => {
  setVsdxRendererForTests(new VsdxRenderer({
    baseUrl: "http://stub",
    fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
  }));
});
afterEach(() => {
  setVsdxRendererForTests(undefined);
});

describe("POST /api/import", () => {
  it("creates a vsdx diagram from valid .vsdx upload", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const body = new FormData();
    body.set("file", new Blob([VSDX_MAGIC, new Uint8Array(100)], { type: "application/vnd.ms-visio.drawing" }), "test.vsdx");
    body.set("name", "Test Visio");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const url = new URL(req.url);
    const res = await handleApi(req, url, { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    const json = await res!.json() as { diagramId: string; slug: string };
    expect(json.diagramId).toMatch(/^d_/);
    expect(json.slug).toBe("test-visio");
  });

  it("rejects upload missing vsdx magic bytes (400)", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const body = new FormData();
    body.set("file", new Blob([new Uint8Array([0, 0, 0, 0])]), "fake.vsdx");
    body.set("name", "Fake");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(400);
  });

  it("rejects upload exceeding VSDX_MAX_BYTES (413)", async () => {
    process.env.VSDX_MAX_BYTES = "100";
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const body = new FormData();
    const big = new Uint8Array(200);
    big.set(VSDX_MAGIC, 0);
    body.set("file", new Blob([big]), "big.vsdx");
    body.set("name", "Big");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(413);
    delete process.env.VSDX_MAX_BYTES;
  });

  it("handles repeated uploads with omitted name by suffixing the slug", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    // Helper: build a tiny upload form without 'name'
    const upload = async () => {
      const body = new FormData();
      body.set("file", new Blob([VSDX_MAGIC, new Uint8Array(100)]), "test.vsdx");
      // intentionally omit name
      const req = new Request("http://x/api/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${ws.id}` },
        body,
      });
      return handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    };
    const r1 = await upload();
    expect(r1!.status).toBe(200);
    const r2 = await upload();
    expect(r2!.status).toBe(200); // should NOT 500
    const j1 = await r1!.json() as { slug: string };
    const j2 = await r2!.json() as { slug: string };
    expect(j1.slug).not.toBe(j2.slug); // both succeeded with different slugs
  });
});
