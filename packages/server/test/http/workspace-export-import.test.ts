// Issue #8 Wave 1B — HTTP route tests for .pviz bundle export/import.
//
// Covers:
//  - GET /api/workspaces/:id/export auth: missing bearer 401; wrong-id 404
//    (no leak); matching id 200 with Content-Type + Content-Disposition.
//  - POST /api/workspaces/import always creates a NEW workspace and never
//    modifies the caller's existing workspace (acceptance criterion in #8).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace, getWorkspace, hashOwnerToken, updateWorkspaceTiles } from "../../src/db/workspaces";
import { createDiagram, listDiagrams } from "../../src/db/diagrams";
import { handleApi } from "../../src/http/routes";
import { newTileId, type Tile } from "@prixmaviz/shared";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

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

const fakeHub = { broadcast: () => {} } as never;
const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

beforeEach(reset);
afterEach(closeDb);

describe("GET /api/workspaces/:id/export", () => {
  it("401 without Authorization header", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const req = new Request(`http://x/api/workspaces/${ws.id}/export`);
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(401);
  });

  it("404 when bearer authenticates a different workspace (no existence leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    // Caller is workspace b, trying to export workspace a.
    const req = new Request(`http://x/api/workspaces/${a.id}/export`, {
      headers: { Authorization: `Bearer ${b.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(404);
    const body = await res!.json();
    expect(body.error).toBe("workspace not found");
  });

  it("200 returns a zip with proper headers and parseable manifest", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql, "My Cool Workspace");
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "one", name: "One", engine: "mermaid", kind: "graph",
    });
    const req = new Request(`http://x/api/workspaces/${ws.id}/export`, {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("application/zip");
    const cd = res!.headers.get("Content-Disposition");
    expect(cd).toContain("attachment");
    expect(cd).toContain("My Cool Workspace.pviz");
    const buf = new Uint8Array(await res!.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);

    // Bundle is parseable.
    const { parseBundle } = await import("../../src/bundle/pviz-reader");
    const parsed = await parseBundle(buf);
    expect(parsed.manifest.workspaceName).toBe("My Cool Workspace");
    expect(parsed.diagrams.length).toBe(1);
  });

  it("sanitizes unsafe characters in workspace name for the filename", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql, 'evil/name\r\n"badchars*');
    const req = new Request(`http://x/api/workspaces/${ws.id}/export`, {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    const cd = res!.headers.get("Content-Disposition")!;
    // None of these chars allowed in the filename.
    expect(cd).not.toContain("/");
    expect(cd).not.toContain("\r");
    expect(cd).not.toContain("\n");
    // We escape *internal* quotes (none here once removed). Filename is wrapped in quotes.
    expect(cd).toMatch(/filename="[^"]+\.pviz"/);
  });
});

describe("POST /api/workspaces/import", () => {
  it("401 without Authorization header", async () => {
    const sql = getDb(TEST_DB_URL);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(0)]), "x.pviz");
    const req = new Request("http://x/api/workspaces/import", { method: "POST", body: form });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(401);
  });

  it("always creates a NEW workspace; caller's existing workspace is untouched", async () => {
    const sql = getDb(TEST_DB_URL);
    // Caller's existing workspace has 1 diagram, custom tiles.
    const caller = await createWorkspace(sql, "Caller's Existing");
    await createDiagram(sql, {
      workspaceId: caller.id, slug: "existing-thing", name: "Existing Thing",
      engine: "mermaid", kind: "graph",
    });
    const callerExistingTiles: Tile[] = [
      { id: newTileId(), diagramId: "x", diagramSlug: "x", x: 99, y: 99, w: 100, h: 100, z: 0 },
    ];
    await updateWorkspaceTiles(sql, caller.id, callerExistingTiles);

    // Build a separate source workspace to export.
    const source = await createWorkspace(sql, "Imported Bundle");
    await createDiagram(sql, {
      workspaceId: source.id, slug: "imported", name: "Imported",
      engine: "d2", kind: "passthrough", dsl: "x -> y",
    });
    const { composeBundle } = await import("../../src/bundle/pviz-writer");
    const bundle = await composeBundle(sql, source.id);

    // Caller uploads the bundle.
    const form = new FormData();
    form.set("file", new Blob([bundle], { type: "application/zip" }), "imported.pviz");
    const req = new Request("http://x/api/workspaces/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${caller.id}` },
      body: form,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    const body = await res!.json() as { workspaceId: string; diagramCount: number; importedAt: string };

    // New workspace is fresh and != caller's.
    expect(body.workspaceId).not.toBe(caller.id);
    expect(body.workspaceId).not.toBe(source.id);
    expect(body.diagramCount).toBe(1);

    // Caller's workspace is UNCHANGED.
    const callerAfter = await getWorkspace(sql, caller.id);
    expect(callerAfter).not.toBeNull();
    expect(callerAfter!.name).toBe("Caller's Existing");
    expect(callerAfter!.tiles.length).toBe(1);
    expect(callerAfter!.tiles[0]!.x).toBe(99);
    const callerDiagrams = await listDiagrams(sql, caller.id);
    expect(callerDiagrams.length).toBe(1);
    expect(callerDiagrams[0]!.slug).toBe("existing-thing");

    // New workspace has the bundle's content + caller-owned hash so
    // MCP list_workspaces would find it.
    const newWs = await getWorkspace(sql, body.workspaceId);
    expect(newWs).not.toBeNull();
    expect(newWs!.name).toBe("Imported Bundle");
    const newDiagrams = await listDiagrams(sql, body.workspaceId);
    expect(newDiagrams.length).toBe(1);
    expect(newDiagrams[0]!.slug).toBe("imported");

    // Verify owner_token_hash matches sha256(caller token).
    const rows = await sql<{ owner_token_hash: string | null }[]>`
      SELECT owner_token_hash FROM workspaces WHERE id = ${body.workspaceId}
    `;
    expect(rows[0]!.owner_token_hash).toBe(hashOwnerToken(caller.id));
  });

  it("400 when the upload is not a valid bundle (e.g. random bytes)", async () => {
    const sql = getDb(TEST_DB_URL);
    const caller = await createWorkspace(sql);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([1, 2, 3, 4])]), "junk.pviz");
    const req = new Request("http://x/api/workspaces/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${caller.id}` },
      body: form,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(400);
    const body = await res!.json() as { error: { code: string } };
    expect(body.error.code).toBe("invalid_zip");
  });

  it("422 when bundle version is unsupported", async () => {
    const sql = getDb(TEST_DB_URL);
    const caller = await createWorkspace(sql);
    // Build a bundle whose manifest claims version 2.0.
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      version: "2.0",
      workspaceId: "w",
      workspaceName: null,
      createdAt: new Date().toISOString(),
      settings: {},
      diagramCount: 0,
    }));
    zip.file("tiles.json", JSON.stringify({ tiles: [], camera: { x: 0, y: 0, zoom: 1 } }));
    const buf = await zip.generateAsync({ type: "uint8array" });
    const form = new FormData();
    form.set("file", new Blob([buf]), "future.pviz");
    const req = new Request("http://x/api/workspaces/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${caller.id}` },
      body: form,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(422);
    const body = await res!.json() as { error: { code: string } };
    expect(body.error.code).toBe("unsupported_version");
  });

  it("413 when upload exceeds PVIZ_BUNDLE_MAX_BYTES", async () => {
    const orig = process.env.PVIZ_BUNDLE_MAX_BYTES;
    process.env.PVIZ_BUNDLE_MAX_BYTES = "50";
    try {
      const sql = getDb(TEST_DB_URL);
      const caller = await createWorkspace(sql);
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(200)]), "big.pviz");
      const req = new Request("http://x/api/workspaces/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${caller.id}` },
        body: form,
      });
      const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
      expect(res!.status).toBe(413);
    } finally {
      if (orig === undefined) delete process.env.PVIZ_BUNDLE_MAX_BYTES;
      else process.env.PVIZ_BUNDLE_MAX_BYTES = orig;
    }
  });
});
