import type postgres from "postgres";
import type { DiagramEngine, DiagramKind } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;

export interface DbDiagramVersion {
  id: string;
  diagramId: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  source: string | null;
  createdAt: string;
}

function rowToVersion(row: Record<string, unknown>): DbDiagramVersion {
  return {
    id: row.id as string,
    diagramId: row.diagram_id as string,
    engine: row.engine as DiagramEngine,
    kind: row.kind as DiagramKind,
    source: (row.source as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function newVersionId(): string {
  return `v_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Snapshot a diagram's prior state into the history table. Called by the
 * write-path right before `updateDiagram` overwrites the source. Returns the
 * inserted row.
 *
 * `source` is the DSL text for passthrough engines; for graph/binary kinds
 * it is null (the IR / bytes themselves are not snapshotted in MVP — the
 * graph-DSL roundtrip is lossy, and binary diffs aren't useful).
 */
export async function snapshotVersion(
  sql: Sql,
  input: {
    diagramId: string;
    engine: DiagramEngine;
    kind: DiagramKind;
    source: string | null;
  },
): Promise<DbDiagramVersion> {
  const id = newVersionId();
  const rows = await sql`
    INSERT INTO diagram_versions (id, diagram_id, engine, kind, source)
    VALUES (${id}, ${input.diagramId}, ${input.engine}, ${input.kind}, ${input.source})
    RETURNING *
  `;
  return rowToVersion(rows[0]!);
}

/** List a diagram's versions, newest-first. */
export async function listVersions(
  sql: Sql,
  diagramId: string,
): Promise<DbDiagramVersion[]> {
  const rows = await sql`
    SELECT * FROM diagram_versions
    WHERE diagram_id = ${diagramId}
    ORDER BY created_at DESC, id DESC
  `;
  return rows.map(rowToVersion);
}

/** Look up a single version. */
export async function getVersion(
  sql: Sql,
  versionId: string,
): Promise<DbDiagramVersion | null> {
  const rows = await sql`
    SELECT * FROM diagram_versions WHERE id = ${versionId}
  `;
  return rows.length > 0 ? rowToVersion(rows[0]!) : null;
}
