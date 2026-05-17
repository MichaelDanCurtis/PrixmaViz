import type postgres from "postgres";
import type { DiagramEngine, DiagramKind, GraphIR } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;

// porsager/postgres' JSONValue type intentionally rejects plain `object` and
// types without an index signature; in practice JSON.stringify accepts them.
// Cast through `unknown` keeps the call sites readable without `any`.
type JSONLike = Parameters<Sql["json"]>[0];

export interface DbDiagram {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir: GraphIR | null;
  dsl: string | null;
  svg: string | null;
  bytes: Uint8Array | null;
  meta: Record<string, unknown>;
  publicView: boolean;
  /**
   * Slash-delimited folder path (no leading/trailing slash). Empty string =
   * workspace root. Added in migration 0007 with default ''. Issue #7.
   */
  parentPath: string;
  /**
   * Pinned to the top of the Library. Added in migration 0008 with default
   * false. Issue #7.
   */
  pinned: boolean;
  /**
   * ISO-8601 timestamp of the last open (createTile / loadBySlug), or null
   * if never opened. Added in migration 0008. Issue #7.
   */
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToDiagram(row: Record<string, unknown>): DbDiagram {
  const rawBytes = row.bytes as Buffer | Uint8Array | null | undefined;
  const lastOpenedAt = row.last_opened_at as Date | null | undefined;
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    slug: row.slug as string,
    name: row.name as string,
    engine: row.engine as DiagramEngine,
    kind: row.kind as DiagramKind,
    ir: (row.ir as GraphIR | null) ?? null,
    dsl: (row.dsl as string | null) ?? null,
    svg: (row.svg as string | null) ?? null,
    bytes: rawBytes ? new Uint8Array(rawBytes) : null,
    meta: row.meta as Record<string, unknown>,
    publicView: row.public_view as boolean,
    parentPath: (row.parent_path as string | null) ?? "",
    pinned: (row.pinned as boolean | null) ?? false,
    lastOpenedAt: lastOpenedAt ? lastOpenedAt.toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

/**
 * Issue #7 folder-path validator. Empty string (workspace root) is allowed.
 * Otherwise: lower/upper-alphanumeric kebab-case segments, no leading or
 * trailing slash, no double-slashes, no `..`.
 *
 * Single source of truth shared by dbMoveDiagram, dbRenameFolder (folder
 * target), and the empty-folder helpers in folders.ts. Centralized here so
 * the regex doesn't drift between callers.
 */
export const FOLDER_PATH_RE = /^([a-z0-9](?:[a-z0-9-_/]*[a-z0-9])?)?$/i;

export function isValidFolderPath(path: string): boolean {
  if (path.includes("..")) return false;
  if (path.includes("//")) return false;
  return FOLDER_PATH_RE.test(path);
}

function newDiagramId(): string {
  return `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function createDiagram(sql: Sql, input: {
  workspaceId: string;
  slug: string;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  bytes?: Uint8Array;
}): Promise<DbDiagram> {
  const id = newDiagramId();
  const rows = await sql`
    INSERT INTO diagrams (id, workspace_id, slug, name, engine, kind, ir, dsl, bytes)
    VALUES (
      ${id},
      ${input.workspaceId},
      ${input.slug},
      ${input.name},
      ${input.engine},
      ${input.kind},
      ${input.ir ? sql.json(input.ir as unknown as JSONLike) : null},
      ${input.dsl ?? null},
      ${input.bytes ? Buffer.from(input.bytes) : null}
    )
    RETURNING *
  `;
  return rowToDiagram(rows[0]!);
}

/**
 * Create a diagram, retrying with a random suffix on the slug if a
 * UNIQUE (workspace_id, slug) constraint violation occurs. Useful when the
 * caller cannot guarantee slug uniqueness up-front (e.g. nameless imports
 * that derive a slug from a filename).
 *
 * Up to 5 attempts: first uses the provided slug as-is, subsequent attempts
 * append a short random suffix. Any non-23505 error is re-thrown immediately.
 */
export async function createDiagramWithUniqueSlug(sql: Sql, input: {
  workspaceId: string;
  slug: string;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  bytes?: Uint8Array;
}): Promise<DbDiagram> {
  const baseSlug = input.slug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0
      ? baseSlug
      : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      return await createDiagram(sql, { ...input, slug });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "23505") throw e; // not a unique violation — bubble up
    }
  }
  throw new Error("could not generate a unique slug after 5 attempts");
}

export async function getDiagram(sql: Sql, workspaceId: string, id: string): Promise<DbDiagram | null> {
  const rows = await sql`
    SELECT * FROM diagrams WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
  return rows.length > 0 ? rowToDiagram(rows[0]!) : null;
}

export async function getDiagramBySlug(sql: Sql, workspaceId: string, slug: string): Promise<DbDiagram | null> {
  const rows = await sql`
    SELECT * FROM diagrams WHERE slug = ${slug} AND workspace_id = ${workspaceId}
  `;
  return rows.length > 0 ? rowToDiagram(rows[0]!) : null;
}

export async function listDiagrams(sql: Sql, workspaceId: string): Promise<DbDiagram[]> {
  const rows = await sql`
    SELECT * FROM diagrams WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
  `;
  return rows.map(rowToDiagram);
}

export async function updateDiagram(sql: Sql, workspaceId: string, id: string, patch: Partial<{
  name: string;
  ir: GraphIR;
  dsl: string;
  svg: string;
  bytes: Uint8Array;
  meta: Record<string, unknown>;
}>): Promise<DbDiagram | null> {
  // Build the set of columns to update. Use sql.json() for JSONB columns.
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.ir !== undefined) updates.ir = sql.json(patch.ir as unknown as JSONLike);
  if (patch.dsl !== undefined) updates.dsl = patch.dsl;
  if (patch.svg !== undefined) updates.svg = patch.svg;
  if (patch.bytes !== undefined) updates.bytes = Buffer.from(patch.bytes);
  if (patch.meta !== undefined) updates.meta = sql.json(patch.meta as unknown as JSONLike);

  if (Object.keys(updates).length === 0) {
    // no-op: empty patch returns current row without touching updated_at
    return await getDiagram(sql, workspaceId, id);
  }

  updates.updated_at = sql`now()`;

  const rows = await sql`
    UPDATE diagrams SET ${sql(updates)}
    WHERE id = ${id} AND workspace_id = ${workspaceId}
    RETURNING *
  `;
  return rows.length > 0 ? rowToDiagram(rows[0]!) : null;
}

export async function deleteDiagram(sql: Sql, workspaceId: string, id: string): Promise<void> {
  await sql`DELETE FROM diagrams WHERE id = ${id} AND workspace_id = ${workspaceId}`;
}

export async function setDiagramPublic(sql: Sql, workspaceId: string, id: string, isPublic: boolean): Promise<void> {
  await sql`
    UPDATE diagrams SET public_view = ${isPublic}, updated_at = now()
    WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
}

export async function getPublicDiagram(sql: Sql, id: string): Promise<DbDiagram | null> {
  const rows = await sql`
    SELECT * FROM diagrams WHERE id = ${id} AND public_view = true
  `;
  return rows.length > 0 ? rowToDiagram(rows[0]!) : null;
}

// ─────────────────────────────────────────────────────────────────────
// Issue #7 — folder / pin / recent / metadata helpers
// ─────────────────────────────────────────────────────────────────────
//
// These intentionally take only `diagramId` (no workspaceId scope) — the
// HTTP route / MCP tool dispatcher performs the auth + ownership check
// (look up the diagram in the caller's workspace) BEFORE invoking these.
// Matches the symmetric signature shape Wave 1B's tool wrappers expect.

/**
 * Toggle the `pinned` flag and return the persisted new state. Bumps
 * `updated_at` so Library sort-by-updated reflects the action.
 *
 * Returns `null` if the diagram does not exist.
 */
export async function dbSetPinned(
  sql: Sql,
  diagramId: string,
  pinned: boolean,
): Promise<boolean | null> {
  const rows = await sql<{ pinned: boolean }[]>`
    UPDATE diagrams
       SET pinned = ${pinned}, updated_at = now()
     WHERE id = ${diagramId}
   RETURNING pinned
  `;
  return rows.length > 0 ? rows[0]!.pinned : null;
}

/**
 * Update `last_opened_at = now()` with a 1-second debounce: the write is
 * a no-op when the column was bumped within the last second. This keeps
 * a tight WS reconnect / re-open loop from producing a write storm
 * against the `idx_diagrams_recent` partial index.
 *
 * Returns the current `last_opened_at` after the call (either the new
 * `now()` or the previous value if debounced). Returns `null` only when
 * the diagram does not exist.
 *
 * Intentionally does NOT bump `updated_at` — "I last opened this" is a
 * read-side event; we don't want it to reshuffle the by-updated sort.
 */
export async function dbBumpLastOpenedAt(
  sql: Sql,
  diagramId: string,
): Promise<string | null> {
  const rows = await sql<{ last_opened_at: Date | null }[]>`
    UPDATE diagrams
       SET last_opened_at = now()
     WHERE id = ${diagramId}
       AND (last_opened_at IS NULL OR now() - last_opened_at > interval '1 second')
   RETURNING last_opened_at
  `;
  if (rows.length > 0) {
    return rows[0]!.last_opened_at?.toISOString() ?? null;
  }
  // Debounced (no update happened) — read back the existing timestamp.
  const existing = await sql<{ last_opened_at: Date | null }[]>`
    SELECT last_opened_at FROM diagrams WHERE id = ${diagramId}
  `;
  if (existing.length === 0) return null;
  return existing[0]!.last_opened_at?.toISOString() ?? null;
}

/**
 * Move a diagram into a folder by setting `parent_path`. Validates the
 * target against {@link isValidFolderPath} — throws on invalid input
 * BEFORE touching the DB so the caller can return a 400 cleanly.
 *
 * Returns the new `parentPath` on success, or `null` if the diagram does
 * not exist. Bumps `updated_at` so the move surfaces in by-updated sort.
 */
export async function dbMoveDiagram(
  sql: Sql,
  diagramId: string,
  parentPath: string,
): Promise<string | null> {
  if (!isValidFolderPath(parentPath)) {
    throw new Error(`invalid folder path: ${JSON.stringify(parentPath)}`);
  }
  const rows = await sql<{ parent_path: string }[]>`
    UPDATE diagrams
       SET parent_path = ${parentPath}, updated_at = now()
     WHERE id = ${diagramId}
   RETURNING parent_path
  `;
  return rows.length > 0 ? rows[0]!.parent_path : null;
}

/**
 * Patch user-editable metadata fields (`description`, `author`, `notes`)
 * on the `meta` JSONB column. Uses JSONB `||` merge so other keys
 * (`tags`, `sourcePaths`, `createdAt`, `updatedAt`, etc.) are preserved.
 *
 * Each undefined patch field is dropped from the merge (no `{ description:
 * null }` clobber); an explicit empty string DOES persist (caller's
 * choice to clear).
 *
 * Returns the new merged `meta` on success, or `null` if the diagram
 * does not exist. Bumps `updated_at`.
 */
export async function dbUpdateMeta(
  sql: Sql,
  diagramId: string,
  patch: { description?: string; author?: string; notes?: string },
): Promise<Record<string, unknown> | null> {
  const merge: Record<string, string> = {};
  if (patch.description !== undefined) merge.description = patch.description;
  if (patch.author !== undefined) merge.author = patch.author;
  if (patch.notes !== undefined) merge.notes = patch.notes;

  if (Object.keys(merge).length === 0) {
    // Empty patch — return current meta unchanged.
    const rows = await sql<{ meta: Record<string, unknown> }[]>`
      SELECT meta FROM diagrams WHERE id = ${diagramId}
    `;
    return rows.length > 0 ? rows[0]!.meta : null;
  }

  const rows = await sql<{ meta: Record<string, unknown> }[]>`
    UPDATE diagrams
       SET meta = meta || ${sql.json(merge as unknown as JSONLike)}::jsonb,
           updated_at = now()
     WHERE id = ${diagramId}
   RETURNING meta
  `;
  return rows.length > 0 ? rows[0]!.meta : null;
}

/**
 * Distinct list of tags used by any diagram in the workspace. Powers the
 * F3 tag-autocomplete UI. Backed by the GIN index over `meta->'tags'`
 * (migration 0004).
 *
 * Returns tags in alphabetical order for deterministic UI. Empty array
 * when no diagrams have any tags.
 */
export async function dbListTags(sql: Sql, workspaceId: string): Promise<string[]> {
  const rows = await sql<{ tag: string }[]>`
    SELECT DISTINCT jsonb_array_elements_text(meta -> 'tags') AS tag
      FROM diagrams
     WHERE workspace_id = ${workspaceId}
       AND jsonb_typeof(meta -> 'tags') = 'array'
     ORDER BY tag
  `;
  return rows.map((r) => r.tag);
}
