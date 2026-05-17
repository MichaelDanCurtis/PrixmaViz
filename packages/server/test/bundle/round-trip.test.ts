// Issue #8 Wave 1B — `.pviz` bundle round-trip.
//
// Builds a workspace with 5 diagrams (mixed engines), tags + per-diagram
// meta, annotations on a subset, a tile layout, and custom camera; exports
// it as a bundle; imports the bundle into a fresh workspace; asserts every
// piece of state landed in the new workspace with fresh IDs but otherwise
// equivalent content. Also verifies the original workspace was untouched.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import {
  createWorkspace,
  getWorkspace,
  updateWorkspaceCamera,
  updateWorkspaceSettings,
  updateWorkspaceTiles,
  hashOwnerToken,
} from "../../src/db/workspaces";
import { createDiagram, updateDiagram, dbMoveDiagram, dbSetPinned, listDiagrams } from "../../src/db/diagrams";
import { addAnnotation, listAnnotations } from "../../src/db/annotations";
import { composeBundle } from "../../src/bundle/pviz-writer";
import { parseBundle } from "../../src/bundle/pviz-reader";
import { importBundle } from "../../src/bundle/pviz-import";
import { newAnnotationId, newTileId, type Tile } from "@prixmaviz/shared";

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

beforeEach(reset);
afterEach(closeDb);

describe(".pviz bundle round-trip", () => {
  it("5-diagram workspace with tags + annotations + tile layout round-trips", async () => {
    const sql = getDb(TEST_DB_URL);

    // ─── Source workspace ──────────────────────────────────────────────
    const sourceWs = await createWorkspace(sql, "Source Workspace");
    await updateWorkspaceSettings(sql, sourceWs.id, { theme: "dark", kroki: { url: "http://x" } });
    await updateWorkspaceCamera(sql, sourceWs.id, { x: 250, y: -120, zoom: 1.5 });

    // Five diagrams, mixed engines + kinds.
    const d1 = await createDiagram(sql, {
      workspaceId: sourceWs.id, slug: "alpha", name: "Alpha",
      engine: "mermaid", kind: "graph",
      ir: { layout: { direction: "TB" }, nodes: { a: { id: "a", label: "A", shape: "rect" } }, edges: {}, groups: {} },
      dsl: "flowchart TD\nA",
    });
    const d2 = await createDiagram(sql, {
      workspaceId: sourceWs.id, slug: "beta", name: "Beta",
      engine: "plantuml", kind: "passthrough", dsl: "@startuml\nAlice -> Bob\n@enduml",
    });
    const d3 = await createDiagram(sql, {
      workspaceId: sourceWs.id, slug: "gamma", name: "Gamma",
      engine: "d2", kind: "passthrough", dsl: "a -> b",
    });
    const d4 = await createDiagram(sql, {
      workspaceId: sourceWs.id, slug: "delta", name: "Delta",
      engine: "graphviz", kind: "passthrough", dsl: "digraph { a -> b }",
    });
    const d5 = await createDiagram(sql, {
      workspaceId: sourceWs.id, slug: "epsilon", name: "Epsilon",
      engine: "mermaid", kind: "passthrough", dsl: "graph LR; A-->B;",
    });

    // Tag/meta + svg + parentPath + pinned on each.
    await updateDiagram(sql, sourceWs.id, d1.id, { svg: "<svg>alpha</svg>", meta: { tags: ["arch", "core"], description: "Alpha desc" } });
    await updateDiagram(sql, sourceWs.id, d2.id, { svg: "<svg>beta</svg>", meta: { tags: ["seq"], author: "kira" } });
    await updateDiagram(sql, sourceWs.id, d3.id, { svg: "<svg>gamma</svg>", meta: { tags: ["wip"], notes: "in progress" } });
    await updateDiagram(sql, sourceWs.id, d4.id, { svg: "<svg>delta</svg>", meta: { tags: ["arch"] } });
    await updateDiagram(sql, sourceWs.id, d5.id, { svg: "<svg>epsilon</svg>", meta: {} });
    await dbMoveDiagram(sql, d2.id, "design");
    await dbMoveDiagram(sql, d3.id, "design/wip");
    await dbSetPinned(sql, d1.id, true);
    await dbSetPinned(sql, d4.id, true);

    // Annotations on a subset.
    await addAnnotation(sql, d1.id, {
      id: newAnnotationId(), kind: "tag", text: "alpha-tag-1", createdAt: new Date().toISOString(),
      targetNodes: ["a"],
    });
    await addAnnotation(sql, d1.id, {
      id: newAnnotationId(), kind: "pin", text: "alpha-pin",
      createdAt: new Date().toISOString(),
      point: { x: 10, y: 20 },
    });
    await addAnnotation(sql, d3.id, {
      id: newAnnotationId(), kind: "region", text: "gamma-region",
      createdAt: new Date().toISOString(),
      bboxPixel: { x: 5, y: 5, w: 100, h: 50 },
    });

    // Tile layout — two tiles, distinct positions.
    const tiles: Tile[] = [
      { id: newTileId(), diagramId: d1.id, diagramSlug: d1.slug, x: 100, y: 200, w: 600, h: 400, z: 0 },
      { id: newTileId(), diagramId: d3.id, diagramSlug: d3.slug, x: 800, y: 50, w: 500, h: 350, z: 1 },
    ];
    await updateWorkspaceTiles(sql, sourceWs.id, tiles);

    // ─── Export → parse → import ──────────────────────────────────────
    const zipBuf = await composeBundle(sql, sourceWs.id);
    expect(zipBuf.length).toBeGreaterThan(0);
    // Zip magic.
    expect(zipBuf[0]).toBe(0x50);
    expect(zipBuf[1]).toBe(0x4b);

    const parsed = await parseBundle(zipBuf);
    expect(parsed.manifest.version).toBe("1.0");
    expect(parsed.manifest.diagramCount).toBe(5);
    expect(parsed.diagrams.length).toBe(5);
    expect(parsed.tiles.length).toBe(2);
    expect(parsed.camera).toEqual({ x: 250, y: -120, zoom: 1.5 });
    // 2 of 5 diagrams have annotations.
    expect(Object.keys(parsed.annotations).sort()).toEqual([d1.slug, d3.slug].sort());

    // Pretend we are a different caller — fake bearer hash.
    const callerHash = hashOwnerToken("00000000-0000-0000-0000-deadbeefcafe");
    const result = await importBundle(sql, parsed, callerHash);

    expect(result.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.workspaceId).not.toBe(sourceWs.id);
    expect(result.diagramCount).toBe(5);
    expect(result.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // ─── Verify new workspace ──────────────────────────────────────────
    const newWs = await getWorkspace(sql, result.workspaceId);
    expect(newWs).not.toBeNull();
    expect(newWs!.name).toBe("Source Workspace");
    expect(newWs!.settings).toEqual({ theme: "dark", kroki: { url: "http://x" } });
    expect(newWs!.camera).toEqual({ x: 250, y: -120, zoom: 1.5 });
    expect(newWs!.tiles.length).toBe(2);
    // Tiles preserved positions but got fresh ids + remapped diagramId.
    for (const t of newWs!.tiles) {
      expect(t.id).not.toBe(tiles[0]!.id);
      expect(t.id).not.toBe(tiles[1]!.id);
      // diagramId points at a NEW row.
      expect([d1.id, d2.id, d3.id, d4.id, d5.id]).not.toContain(t.diagramId);
    }
    const sortedSrcTiles = [...tiles].sort((a, b) => a.x - b.x);
    const sortedNewTiles = [...newWs!.tiles].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sortedSrcTiles.length; i++) {
      expect(sortedNewTiles[i]!.x).toBe(sortedSrcTiles[i]!.x);
      expect(sortedNewTiles[i]!.y).toBe(sortedSrcTiles[i]!.y);
      expect(sortedNewTiles[i]!.w).toBe(sortedSrcTiles[i]!.w);
      expect(sortedNewTiles[i]!.h).toBe(sortedSrcTiles[i]!.h);
      expect(sortedNewTiles[i]!.z).toBe(sortedSrcTiles[i]!.z);
    }

    // Diagrams — same count, same slugs, fresh IDs.
    const newDiagrams = await listDiagrams(sql, result.workspaceId);
    expect(newDiagrams.length).toBe(5);
    const newBySlug = new Map(newDiagrams.map((d) => [d.slug, d]));
    for (const slug of [d1.slug, d2.slug, d3.slug, d4.slug, d5.slug]) {
      const nd = newBySlug.get(slug);
      expect(nd).toBeDefined();
      expect(nd!.workspaceId).toBe(result.workspaceId);
      expect(nd!.id).not.toBe(d1.id);
      expect(nd!.id).not.toBe(d2.id);
      expect(nd!.id).not.toBe(d3.id);
      expect(nd!.id).not.toBe(d4.id);
      expect(nd!.id).not.toBe(d5.id);
    }
    // Field-level checks on alpha.
    const newAlpha = newBySlug.get("alpha")!;
    expect(newAlpha.name).toBe("Alpha");
    expect(newAlpha.engine).toBe("mermaid");
    expect(newAlpha.kind).toBe("graph");
    expect(newAlpha.svg).toBe("<svg>alpha</svg>");
    expect(newAlpha.pinned).toBe(true);
    expect((newAlpha.meta as { tags?: string[] }).tags).toEqual(["arch", "core"]);
    // originalId preserved.
    expect((newAlpha.meta as { originalId?: string }).originalId).toBe(d1.id);

    // Folder structure preserved.
    expect(newBySlug.get("beta")!.parentPath).toBe("design");
    expect(newBySlug.get("gamma")!.parentPath).toBe("design/wip");
    expect(newBySlug.get("delta")!.pinned).toBe(true);

    // Annotations remapped onto fresh diagram ids.
    const newAlphaAnns = await listAnnotations(sql, newAlpha.id, { includeResolved: true });
    expect(newAlphaAnns.length).toBe(2);
    const texts = new Set(newAlphaAnns.map((a) => a.text));
    expect(texts.has("alpha-tag-1")).toBe(true);
    expect(texts.has("alpha-pin")).toBe(true);
    // Fresh annotation ids.
    expect(newAlphaAnns[0]!.id).toMatch(/^ann_/);

    const newGamma = newBySlug.get("gamma")!;
    const newGammaAnns = await listAnnotations(sql, newGamma.id, { includeResolved: true });
    expect(newGammaAnns.length).toBe(1);
    expect(newGammaAnns[0]!.text).toBe("gamma-region");
    expect(newGammaAnns[0]!.bboxPixel).toEqual({ x: 5, y: 5, w: 100, h: 50 });

    // ─── Source workspace untouched ────────────────────────────────────
    const srcAfter = await getWorkspace(sql, sourceWs.id);
    expect(srcAfter).not.toBeNull();
    const srcDiagrams = await listDiagrams(sql, sourceWs.id);
    expect(srcDiagrams.length).toBe(5);
  });

  it("vsdx binary diagram's bytes survive the round-trip via base64 in the JSON", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql, "vsdx-ws");
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff, 0xab]);
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "visio-one", name: "Visio One",
      engine: "vsdx", kind: "binary", bytes,
    });
    const zipBuf = await composeBundle(sql, ws.id);
    const parsed = await parseBundle(zipBuf);
    expect(parsed.diagrams.length).toBe(1);
    expect(parsed.diagrams[0]!.bytes).not.toBeNull();
    const out = parsed.diagrams[0]!.bytes!;
    expect(out.length).toBe(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      expect(out[i]).toBe(bytes[i]!);
    }

    // Import and verify the bytes landed in the new row.
    const result = await importBundle(sql, parsed, null);
    const newRows = await listDiagrams(sql, result.workspaceId);
    expect(newRows.length).toBe(1);
    expect(newRows[0]!.bytes).not.toBeNull();
    expect(newRows[0]!.bytes!.length).toBe(bytes.length);
  });

  it("empty workspace round-trips (no diagrams, no annotations, no tiles)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql, "empty");
    const zipBuf = await composeBundle(sql, ws.id);
    const parsed = await parseBundle(zipBuf);
    expect(parsed.diagrams).toEqual([]);
    expect(parsed.tiles).toEqual([]);
    expect(parsed.manifest.diagramCount).toBe(0);

    const result = await importBundle(sql, parsed, null);
    expect(result.diagramCount).toBe(0);
    const newDiagrams = await listDiagrams(sql, result.workspaceId);
    expect(newDiagrams).toEqual([]);
  });
});
