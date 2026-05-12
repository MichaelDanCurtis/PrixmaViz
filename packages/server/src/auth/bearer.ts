import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export type AuthResult =
  | { ok: true; workspaceId: string }
  | { ok: false; status: number; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function authenticate(req: Request, sql: Sql): Promise<AuthResult> {
  const header = req.headers.get("Authorization");
  if (!header) return { ok: false, status: 401, message: "missing Authorization header" };
  const m = /^Bearer\s+([0-9a-f-]{36})$/i.exec(header);
  if (!m || !UUID_RE.test(m[1]!)) return { ok: false, status: 401, message: "malformed Bearer token" };
  const token = m[1]!.toLowerCase();
  const rows = await sql`SELECT id FROM workspaces WHERE id = ${token}`;
  if (rows.length === 0) return { ok: false, status: 401, message: "unknown workspace" };
  return { ok: true, workspaceId: token };
}
