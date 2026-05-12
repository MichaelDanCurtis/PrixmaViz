import type postgres from "postgres";
import type { Workspace, Camera, Tile } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;

function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    name: (row.name as string) ?? null,
    camera: row.camera as Camera,
    tiles: row.tiles as Tile[],
    settings: row.settings as Record<string, unknown>,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    lastSeenAt: (row.last_seen_at as Date).toISOString(),
  };
}

export async function createWorkspace(sql: Sql, name?: string): Promise<Workspace> {
  const rows = await sql`
    INSERT INTO workspaces (name) VALUES (${name ?? null})
    RETURNING *
  `;
  return rowToWorkspace(rows[0]);
}

export async function getWorkspace(sql: Sql, id: string): Promise<Workspace | null> {
  const rows = await sql`SELECT * FROM workspaces WHERE id = ${id}`;
  if (rows.length === 0) return null;
  // Update last_seen_at on every fetch
  await sql`UPDATE workspaces SET last_seen_at = now() WHERE id = ${id}`;
  return rowToWorkspace(rows[0]);
}

export async function updateWorkspaceCamera(sql: Sql, id: string, camera: Camera): Promise<void> {
  await sql`
    UPDATE workspaces
    SET camera = ${sql.json(camera)}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function updateWorkspaceTiles(sql: Sql, id: string, tiles: Tile[]): Promise<void> {
  await sql`
    UPDATE workspaces
    SET tiles = ${sql.json(tiles)}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function updateWorkspaceName(sql: Sql, id: string, name: string | null): Promise<void> {
  await sql`UPDATE workspaces SET name = ${name}, updated_at = now() WHERE id = ${id}`;
}

export async function deleteWorkspace(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM workspaces WHERE id = ${id}`;
}
