import type postgres from "postgres";
import { isValidFolderPath } from "./diagrams";

type Sql = ReturnType<typeof postgres>;

// porsager/postgres' JSONValue type intentionally rejects plain `object` and
// types without an index signature; in practice JSON.stringify accepts them.
// Cast through `unknown` keeps the call sites readable without `any`.
type JSONLike = Parameters<Sql["json"]>[0];

/**
 * Cap how many rows a single folder-rename transaction is allowed to
 * touch. A deep folder reshuffle in a busy workspace would hold the
 * (workspace_id, parent_path) index hot for longer than is fair to
 * concurrent readers. The spec mandates the limit + structured error.
 *
 * Follow-up (out of this epic): row-batched async rename for very large
 * workspaces. For now, the error surfaces cleanly and the caller can
 * decide to refuse the rename or chunk it manually.
 */
export const FOLDER_RENAME_ROW_CAP = 500;

export interface FolderRenameTooLargeError {
  error: "folder rename touches too many rows";
  rows: number;
  cap: number;
}

export interface FolderDeleteHasDiagramsError {
  error: "folder has N diagrams";
  count: number;
}

/**
 * Rename a folder (and every descendant) in a single transaction.
 *
 * SECURITY: uses `starts_with(parent_path, $from || '/')` rather than
 * `parent_path LIKE $from || '/%'`. With LIKE, a user-supplied folder
 * name containing `%` or `_` would silently glob across siblings
 * (`foo%bar` would also rewrite `foo-and-bar`, `foobar`, `foo_bar`,
 * etc.). `starts_with` treats its second arg as a literal — no glob
 * semantics, no escaping required.
 *
 * The matching descendants then get their `parent_path` rewritten as
 * `$to || SUBSTRING(parent_path FROM LENGTH($from) + 1)`, which works
 * for both the folder itself (`parent_path = $from`) and its
 * descendants (`parent_path = $from || '/' || rest`).
 *
 * Caps the transaction at FOLDER_RENAME_ROW_CAP rows. The cap is
 * enforced inside the transaction with a SELECT COUNT BEFORE the
 * UPDATE so we never half-rewrite a giant tree.
 *
 * Returns the number of affected rows on success. Throws a structured
 * error object when:
 *   - `from` or `to` is not a valid folder path (delegated to
 *     {@link isValidFolderPath}), OR
 *   - the rename would touch more than FOLDER_RENAME_ROW_CAP rows.
 */
export async function dbRenameFolder(
  sql: Sql,
  workspaceId: string,
  fromPath: string,
  toPath: string,
): Promise<number> {
  if (!isValidFolderPath(fromPath) || fromPath === "") {
    throw new Error(`invalid source folder: ${JSON.stringify(fromPath)}`);
  }
  if (!isValidFolderPath(toPath) || toPath === "") {
    throw new Error(`invalid target folder: ${JSON.stringify(toPath)}`);
  }
  if (fromPath === toPath) return 0;

  return await sql.begin(async (tx) => {
    // Count matching rows first; the WHERE clause mirrors the UPDATE.
    const countRows = await tx<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
        FROM diagrams
       WHERE workspace_id = ${workspaceId}
         AND (parent_path = ${fromPath} OR starts_with(parent_path, ${fromPath + "/"}))
    `;
    const n = countRows[0]?.n ?? 0;
    if (n > FOLDER_RENAME_ROW_CAP) {
      const err: FolderRenameTooLargeError = {
        error: "folder rename touches too many rows",
        rows: n,
        cap: FOLDER_RENAME_ROW_CAP,
      };
      throw Object.assign(new Error(err.error), err);
    }
    if (n === 0) return 0;

    // SUBSTRING is 1-indexed in SQL; LENGTH($from) + 1 starts the
    // remainder slice. For the folder itself (parent_path = $from),
    // the slice is empty so the new value is exactly $to. For a
    // descendant `$from/<rest>`, the slice is `/<rest>` so the new
    // value is `$to/<rest>`.
    //
    // The `::int` cast on the FROM position is LOAD-BEARING: without
    // it postgres-js binds the integer literal as text, which makes
    // Postgres pick the SIMILAR-TO-pattern overload of SUBSTRING
    // (`SUBSTRING(text FROM pattern)`) instead of the position
    // overload — and the pattern variant silently returns NULL when
    // no match, blowing the NOT NULL constraint on parent_path.
    await tx`
      UPDATE diagrams
         SET parent_path = ${toPath} || SUBSTRING(parent_path FROM ${fromPath.length + 1}::int),
             updated_at = now()
       WHERE workspace_id = ${workspaceId}
         AND (parent_path = ${fromPath} OR starts_with(parent_path, ${fromPath + "/"}))
    `;
    return n;
  });
}

/**
 * Delete a folder. Behavior depends on `cascade`:
 *
 *   - `cascade = false` — if any diagrams live under the path, throws
 *     a structured error `{ error: "folder has N diagrams", count }`.
 *     Otherwise removes the empty-folder entry (if present). This is
 *     the safe default for UI "Delete" buttons.
 *
 *   - `cascade = true` — DELETES every diagram under the path (the
 *     folder itself AND its descendants) AND removes the empty-folder
 *     entry. Returns the count of deleted diagrams.
 *
 * Like rename, this uses `starts_with` not `LIKE` for the descendant
 * match — defense against `%` / `_` in user-supplied folder names.
 *
 * Returns the number of deleted diagrams (0 if folder was already
 * empty or only existed in `workspaces.settings.emptyFolders`).
 */
export async function dbDeleteFolder(
  sql: Sql,
  workspaceId: string,
  path: string,
  cascade: boolean,
): Promise<number> {
  if (!isValidFolderPath(path) || path === "") {
    throw new Error(`invalid folder: ${JSON.stringify(path)}`);
  }

  return await sql.begin(async (tx) => {
    const countRows = await tx<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
        FROM diagrams
       WHERE workspace_id = ${workspaceId}
         AND (parent_path = ${path} OR starts_with(parent_path, ${path + "/"}))
    `;
    const n = countRows[0]?.n ?? 0;

    if (n > 0 && !cascade) {
      const err: FolderDeleteHasDiagramsError = {
        error: "folder has N diagrams",
        count: n,
      };
      throw Object.assign(new Error(err.error), err);
    }

    if (n > 0) {
      await tx`
        DELETE FROM diagrams
         WHERE workspace_id = ${workspaceId}
           AND (parent_path = ${path} OR starts_with(parent_path, ${path + "/"}))
      `;
    }

    // Strip the path from emptyFolders if present (and any descendant
    // empty-folder paths). Inline the empty-folder list rewrite so the
    // diagram delete + settings cleanup happen atomically.
    const wsRows = await tx<{ settings: Record<string, unknown> | null }[]>`
      SELECT settings FROM workspaces WHERE id = ${workspaceId}
    `;
    if (wsRows.length > 0) {
      const settings = wsRows[0]!.settings ?? {};
      const ef = Array.isArray((settings as { emptyFolders?: unknown }).emptyFolders)
        ? (settings as { emptyFolders: unknown[] }).emptyFolders.filter(
            (p): p is string => typeof p === "string",
          )
        : [];
      const filtered = ef.filter((p) => p !== path && !p.startsWith(path + "/"));
      if (filtered.length !== ef.length) {
        const nextSettings = { ...settings, emptyFolders: filtered };
        await tx`
          UPDATE workspaces
             SET settings = ${tx.json(nextSettings as unknown as JSONLike)},
                 updated_at = now()
           WHERE id = ${workspaceId}
        `;
      }
    }

    return n;
  });
}

/**
 * Read the workspace's empty-folder list (folders that exist for the
 * Library tree but have no diagrams in them yet). Lives in
 * `workspaces.settings.emptyFolders: string[]`.
 *
 * Returns an empty array if the workspace has no settings, no
 * `emptyFolders` key, or the key is somehow not an array.
 */
export async function dbListEmptyFolders(
  sql: Sql,
  workspaceId: string,
): Promise<string[]> {
  const rows = await sql<{ settings: Record<string, unknown> | null }[]>`
    SELECT settings FROM workspaces WHERE id = ${workspaceId}
  `;
  if (rows.length === 0) return [];
  const settings = rows[0]!.settings ?? {};
  const raw = (settings as { emptyFolders?: unknown }).emptyFolders;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string");
}

/**
 * Replace the workspace's empty-folder list. Validates every entry via
 * {@link isValidFolderPath} BEFORE writing — one bad entry rejects the
 * whole call rather than letting partial garbage land in settings.
 *
 * Preserves other keys in `workspaces.settings` (only writes back the
 * `emptyFolders` key in the merged object).
 */
export async function dbSetEmptyFolders(
  sql: Sql,
  workspaceId: string,
  list: string[],
): Promise<void> {
  for (const p of list) {
    if (!isValidFolderPath(p) || p === "") {
      throw new Error(`invalid folder in emptyFolders: ${JSON.stringify(p)}`);
    }
  }
  // Deduplicate; preserve caller-given order otherwise.
  const seen = new Set<string>();
  const dedup = list.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));

  await sql.begin(async (tx) => {
    const rows = await tx<{ settings: Record<string, unknown> | null }[]>`
      SELECT settings FROM workspaces WHERE id = ${workspaceId}
    `;
    if (rows.length === 0) {
      throw new Error(`workspace not found: ${workspaceId}`);
    }
    const settings = rows[0]!.settings ?? {};
    const next = { ...settings, emptyFolders: dedup };
    await tx`
      UPDATE workspaces
         SET settings = ${tx.json(next as unknown as JSONLike)},
             updated_at = now()
       WHERE id = ${workspaceId}
    `;
  });
}
