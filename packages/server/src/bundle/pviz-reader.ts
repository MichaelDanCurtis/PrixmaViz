// Issue #8 Wave 1B — `.pviz` workspace bundle reader.
//
// Parses an archive produced by `composeBundle()` in ./pviz-writer.ts.
// Validates the manifest version + required fields per file, then returns
// the parsed payload. The caller (HTTP import route) maps payload diagrams
// to fresh IDs and inserts into a brand-new workspace.
//
// VERSION POLICY
//   - We accept any bundle whose `manifest.version` major matches our
//     supported major (currently `1`). Minor bumps (1.0 -> 1.1) are
//     backwards-compatible; new optional fields are simply not required.
//   - A newer major (e.g. 2.x) is rejected — the new format may not be
//     readable, and the reader refuses rather than guess.
//   - An older major (e.g. 0.x) is rejected too — there is no 0.x to
//     migrate from, and accepting it would hide a bundle-format mismatch.
//
// Errors are thrown as `BundleParseError` with a `code` field so the
// HTTP route can map them to structured 4xx responses.

import JSZip from "jszip";
import type { Annotation } from "@prixmaviz/shared";

export const SUPPORTED_MAJOR_VERSION = 1;

export interface BundleManifest {
  version: string;
  workspaceId: string;
  workspaceName: string | null;
  createdAt: string;
  settings: Record<string, unknown>;
  diagramCount: number;
}

export interface BundleDiagram {
  id: string;
  name: string;
  slug: string;
  engine: string;
  kind: string;
  parentPath: string;
  pinned: boolean;
  lastOpenedAt: string | null;
  ir: unknown;
  dsl: string | null;
  meta: Record<string, unknown>;
  svg: string | null;
  bytes: Uint8Array | null;
  createdAt: string;
  updatedAt: string;
}

export interface BundleTilesPayload {
  tiles: Array<{
    id: string;
    diagramId: string;
    diagramSlug: string;
    x: number;
    y: number;
    w: number;
    h: number;
    z: number;
  }>;
  camera: { x: number; y: number; zoom: number };
}

export interface ParsedBundle {
  manifest: BundleManifest;
  diagrams: BundleDiagram[];
  /** Keyed by diagram slug. Missing slugs = no annotations on that diagram. */
  annotations: Record<string, Annotation[]>;
  tiles: BundleTilesPayload["tiles"];
  camera: BundleTilesPayload["camera"];
}

export type BundleParseErrorCode =
  | "missing_manifest"
  | "malformed_manifest"
  | "unsupported_version"
  | "malformed_diagram"
  | "malformed_annotations"
  | "malformed_tiles"
  | "invalid_zip";

export class BundleParseError extends Error {
  readonly code: BundleParseErrorCode;
  constructor(code: BundleParseErrorCode, message: string) {
    super(message);
    this.name = "BundleParseError";
    this.code = code;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseJsonOrThrow(text: string, code: BundleParseErrorCode, filename: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new BundleParseError(code, `${filename}: invalid JSON (${(e as Error).message})`);
  }
}

function parseManifest(raw: unknown): BundleManifest {
  if (!isRecord(raw)) {
    throw new BundleParseError("malformed_manifest", "manifest.json must be a JSON object");
  }
  const { version, workspaceId, workspaceName, createdAt, settings, diagramCount } = raw;
  if (typeof version !== "string") {
    throw new BundleParseError("malformed_manifest", "manifest.json: `version` must be a string");
  }
  // Major-version check.
  const major = Number(version.split(".")[0]);
  if (!Number.isFinite(major) || major !== SUPPORTED_MAJOR_VERSION) {
    throw new BundleParseError(
      "unsupported_version",
      `unsupported bundle version: ${version} (supported major: ${SUPPORTED_MAJOR_VERSION})`,
    );
  }
  if (typeof workspaceId !== "string") {
    throw new BundleParseError("malformed_manifest", "manifest.json: `workspaceId` must be a string");
  }
  if (workspaceName !== null && typeof workspaceName !== "string") {
    throw new BundleParseError("malformed_manifest", "manifest.json: `workspaceName` must be string or null");
  }
  if (typeof createdAt !== "string") {
    throw new BundleParseError("malformed_manifest", "manifest.json: `createdAt` must be a string");
  }
  if (settings !== undefined && !isRecord(settings)) {
    throw new BundleParseError("malformed_manifest", "manifest.json: `settings` must be an object");
  }
  if (typeof diagramCount !== "number" || !Number.isFinite(diagramCount)) {
    throw new BundleParseError("malformed_manifest", "manifest.json: `diagramCount` must be a number");
  }
  return {
    version,
    workspaceId,
    workspaceName: (workspaceName as string | null) ?? null,
    createdAt,
    settings: (settings as Record<string, unknown>) ?? {},
    diagramCount,
  };
}

function parseDiagram(raw: unknown, filename: string): BundleDiagram {
  if (!isRecord(raw)) {
    throw new BundleParseError("malformed_diagram", `${filename}: must be a JSON object`);
  }
  const required = ["id", "name", "slug", "engine", "kind"] as const;
  for (const key of required) {
    if (typeof raw[key] !== "string") {
      throw new BundleParseError("malformed_diagram", `${filename}: missing/invalid string field \`${key}\``);
    }
  }
  let bytes: Uint8Array | null = null;
  if (typeof raw.bytes === "string" && raw.bytes.length > 0) {
    try {
      bytes = new Uint8Array(Buffer.from(raw.bytes, "base64"));
    } catch (e) {
      throw new BundleParseError("malformed_diagram", `${filename}: invalid base64 in \`bytes\` (${(e as Error).message})`);
    }
  }
  return {
    id: raw.id as string,
    name: raw.name as string,
    slug: raw.slug as string,
    engine: raw.engine as string,
    kind: raw.kind as string,
    parentPath: typeof raw.parentPath === "string" ? raw.parentPath : "",
    pinned: typeof raw.pinned === "boolean" ? raw.pinned : false,
    lastOpenedAt: typeof raw.lastOpenedAt === "string" ? raw.lastOpenedAt : null,
    ir: raw.ir ?? null,
    dsl: typeof raw.dsl === "string" ? raw.dsl : null,
    meta: isRecord(raw.meta) ? raw.meta : {},
    svg: typeof raw.svg === "string" ? raw.svg : null,
    bytes,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function parseAnnotationsFile(raw: unknown, filename: string): { diagramSlug: string; annotations: Annotation[] } {
  if (!isRecord(raw)) {
    throw new BundleParseError("malformed_annotations", `${filename}: must be a JSON object`);
  }
  if (typeof raw.diagramSlug !== "string") {
    throw new BundleParseError("malformed_annotations", `${filename}: missing/invalid \`diagramSlug\``);
  }
  if (!Array.isArray(raw.annotations)) {
    throw new BundleParseError("malformed_annotations", `${filename}: \`annotations\` must be an array`);
  }
  // We trust the writer to have emitted valid Annotation shapes — only
  // surface obvious structural problems here. Detailed per-annotation
  // validation is the importer's job (insertions either succeed or fail).
  for (const a of raw.annotations) {
    if (!isRecord(a) || typeof a.id !== "string" || typeof a.kind !== "string") {
      throw new BundleParseError("malformed_annotations", `${filename}: each annotation needs string \`id\` + \`kind\``);
    }
  }
  return {
    diagramSlug: raw.diagramSlug,
    annotations: raw.annotations as Annotation[],
  };
}

function parseTilesFile(raw: unknown): BundleTilesPayload {
  if (!isRecord(raw)) {
    throw new BundleParseError("malformed_tiles", "tiles.json must be a JSON object");
  }
  if (!Array.isArray(raw.tiles)) {
    throw new BundleParseError("malformed_tiles", "tiles.json: `tiles` must be an array");
  }
  const camera = raw.camera;
  if (!isRecord(camera) ||
      typeof camera.x !== "number" ||
      typeof camera.y !== "number" ||
      typeof camera.zoom !== "number") {
    throw new BundleParseError("malformed_tiles", "tiles.json: `camera` must be {x,y,zoom} numbers");
  }
  const tiles: BundleTilesPayload["tiles"] = [];
  for (const t of raw.tiles) {
    if (!isRecord(t) ||
        typeof t.id !== "string" ||
        typeof t.diagramId !== "string" ||
        typeof t.diagramSlug !== "string") {
      throw new BundleParseError("malformed_tiles", "tiles.json: each tile needs string id/diagramId/diagramSlug");
    }
    tiles.push({
      id: t.id,
      diagramId: t.diagramId,
      diagramSlug: t.diagramSlug,
      x: typeof t.x === "number" ? t.x : 0,
      y: typeof t.y === "number" ? t.y : 0,
      w: typeof t.w === "number" ? t.w : 600,
      h: typeof t.h === "number" ? t.h : 400,
      z: typeof t.z === "number" ? t.z : 0,
    });
  }
  return {
    tiles,
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
  };
}

/**
 * Parse a `.pviz` bundle and return the deserialized payload. Throws
 * `BundleParseError` for any format issue. Network/storage IO is the
 * caller's job — pass in raw bytes.
 */
export async function parseBundle(zipBytes: Uint8Array | Buffer): Promise<ParsedBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch (e) {
    throw new BundleParseError("invalid_zip", `not a valid zip archive: ${(e as Error).message}`);
  }

  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    throw new BundleParseError("missing_manifest", "manifest.json missing — not a valid .pviz bundle");
  }
  const manifestText = await manifestEntry.async("string");
  const manifestRaw = parseJsonOrThrow(manifestText, "malformed_manifest", "manifest.json");
  const manifest = parseManifest(manifestRaw);

  const diagrams: BundleDiagram[] = [];
  const annotations: Record<string, Annotation[]> = {};

  // Pull every diagrams/<slug>.json
  const diagramFiles = zip.file(/^diagrams\/.+\.json$/);
  for (const f of diagramFiles) {
    const text = await f.async("string");
    const raw = parseJsonOrThrow(text, "malformed_diagram", f.name);
    diagrams.push(parseDiagram(raw, f.name));
  }

  // Pull every annotations/<slug>.json
  const annFiles = zip.file(/^annotations\/.+\.json$/);
  for (const f of annFiles) {
    const text = await f.async("string");
    const raw = parseJsonOrThrow(text, "malformed_annotations", f.name);
    const parsed = parseAnnotationsFile(raw, f.name);
    annotations[parsed.diagramSlug] = parsed.annotations;
  }

  // tiles.json — required (writer always emits it, even when empty)
  const tilesEntry = zip.file("tiles.json");
  let tiles: BundleTilesPayload["tiles"] = [];
  let camera: BundleTilesPayload["camera"] = { x: 0, y: 0, zoom: 1 };
  if (tilesEntry) {
    const tilesText = await tilesEntry.async("string");
    const tilesRaw = parseJsonOrThrow(tilesText, "malformed_tiles", "tiles.json");
    const tilesPayload = parseTilesFile(tilesRaw);
    tiles = tilesPayload.tiles;
    camera = tilesPayload.camera;
  }

  return { manifest, diagrams, annotations, tiles, camera };
}
