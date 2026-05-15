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
  createdAt: string;
  updatedAt: string;
}

function rowToDiagram(row: Record<string, unknown>): DbDiagram {
  const rawBytes = row.bytes as Buffer | Uint8Array | null | undefined;
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
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
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
