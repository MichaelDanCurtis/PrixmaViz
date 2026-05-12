import type postgres from "postgres";
import type { Annotation } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;
type JSONLike = Parameters<Sql["json"]>[0];

function rowToAnnotation(row: Record<string, unknown>): Annotation {
  return {
    id: row.id as string,
    kind: row.kind as Annotation["kind"],
    text: (row.text as string) ?? undefined,
    color: (row.color as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : undefined,
    targetNodes: (row.target_nodes as string[]) ?? undefined,
    bboxPixel: (row.bbox_pixel as Annotation["bboxPixel"]) ?? undefined,
    bboxData: row.bbox_data ?? undefined,
    point: (row.point as Annotation["point"]) ?? undefined,
    nearestNode: (row.nearest_node as string) ?? undefined,
  };
}

export async function addAnnotation(sql: Sql, diagramId: string, a: Annotation): Promise<void> {
  await sql`
    INSERT INTO annotations (id, diagram_id, kind, text, color, resolved_at, target_nodes, bbox_pixel, bbox_data, point, nearest_node, created_at)
    VALUES (
      ${a.id},
      ${diagramId},
      ${a.kind},
      ${a.text ?? null},
      ${a.color ?? null},
      ${a.resolvedAt ?? null},
      ${a.targetNodes ? sql.json(a.targetNodes as unknown as JSONLike) : null},
      ${a.bboxPixel ? sql.json(a.bboxPixel as unknown as JSONLike) : null},
      ${a.bboxData !== undefined ? sql.json(a.bboxData as unknown as JSONLike) : null},
      ${a.point ? sql.json(a.point as unknown as JSONLike) : null},
      ${a.nearestNode ?? null},
      ${a.createdAt}
    )
  `;
}

export async function listAnnotations(sql: Sql, diagramId: string, opts: { includeResolved: boolean }): Promise<Annotation[]> {
  if (opts.includeResolved) {
    const rows = await sql`SELECT * FROM annotations WHERE diagram_id = ${diagramId} ORDER BY created_at ASC`;
    return rows.map(rowToAnnotation);
  }
  const rows = await sql`SELECT * FROM annotations WHERE diagram_id = ${diagramId} AND resolved_at IS NULL ORDER BY created_at ASC`;
  return rows.map(rowToAnnotation);
}

export async function updateAnnotation(sql: Sql, diagramId: string, id: string, patch: Partial<Annotation>): Promise<Annotation | null> {
  // Belt-and-braces: never allow kind/createdAt/id to be mutated. We just don't add them to `updates`.
  const updates: Record<string, unknown> = {};
  if (patch.text !== undefined) updates.text = patch.text;
  if (patch.color !== undefined) updates.color = patch.color;
  if (patch.resolvedAt !== undefined) updates.resolved_at = patch.resolvedAt;
  if (patch.targetNodes !== undefined) updates.target_nodes = sql.json(patch.targetNodes as unknown as JSONLike);
  if (patch.bboxPixel !== undefined) updates.bbox_pixel = sql.json(patch.bboxPixel as unknown as JSONLike);
  if (patch.bboxData !== undefined) updates.bbox_data = sql.json(patch.bboxData as unknown as JSONLike);
  if (patch.point !== undefined) updates.point = sql.json(patch.point as unknown as JSONLike);
  if (patch.nearestNode !== undefined) updates.nearest_node = patch.nearestNode;

  if (Object.keys(updates).length === 0) {
    // no-op: empty patch returns current row
    const rows = await sql`SELECT * FROM annotations WHERE id = ${id} AND diagram_id = ${diagramId}`;
    return rows.length > 0 ? rowToAnnotation(rows[0]!) : null;
  }

  const rows = await sql`
    UPDATE annotations SET ${sql(updates)}
    WHERE id = ${id} AND diagram_id = ${diagramId}
    RETURNING *
  `;
  return rows.length > 0 ? rowToAnnotation(rows[0]!) : null;
}

export async function deleteAnnotation(sql: Sql, diagramId: string, id: string): Promise<void> {
  await sql`DELETE FROM annotations WHERE id = ${id} AND diagram_id = ${diagramId}`;
}
