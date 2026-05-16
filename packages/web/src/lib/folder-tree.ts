import type { LibraryEntry } from "@prixmaviz/shared";

/**
 * Folder-tree helpers for the Library sidebar (Issue #7 Wave 2C).
 *
 * The tree is derived from two inputs:
 *   - LibraryEntry[]   — each entry's `parentPath` is the folder it lives
 *                        in. Empty string means workspace root.
 *   - emptyFolders[]   — folder paths that exist but contain no diagrams
 *                        (workspaces.settings.emptyFolders). The "+ New
 *                        folder" UI inserts here.
 *
 * Materialized folders = the set of distinct non-empty prefixes of all
 * `parentPath` values, plus the empty-folder list. We expand each
 * `parentPath` into all of its ancestor prefixes so an entry at
 * "mercury/wire-format/v2" surfaces folders "mercury",
 * "mercury/wire-format", and "mercury/wire-format/v2" in the tree.
 *
 * The functions in this module are pure so tests can exercise the
 * tree shape without rendering.
 */

export interface TreeNode {
  /** Absolute path of this folder (slash-delimited, no leading/trailing slash). */
  path: string;
  /** Last segment of `path` — what the tree row renders. */
  name: string;
  /** Depth from root, 0 = top-level. */
  depth: number;
  /** Sorted child folders. */
  children: TreeNode[];
}

/**
 * Returns the chain of ancestor paths for a folder path, EXCLUDING the
 * empty root. Example:
 *
 *   ancestors("a/b/c") === ["a", "a/b", "a/b/c"]
 *   ancestors("a")     === ["a"]
 *   ancestors("")      === []
 */
export function ancestors(path: string): string[] {
  if (!path) return [];
  const segs = path.split("/");
  const acc: string[] = [];
  let prefix = "";
  for (const seg of segs) {
    prefix = prefix ? `${prefix}/${seg}` : seg;
    acc.push(prefix);
  }
  return acc;
}

/**
 * Materializes the set of folder paths in the workspace.
 *
 * Distinct ancestor prefixes of every entry's parentPath ∪ emptyFolders.
 * Sorted lexicographically (the caller passes this to buildTree, which
 * re-sorts at each level anyway — but a sorted input avoids a wobble in
 * the depth-first traversal when paths share parents but appear out of
 * order in the input).
 */
export function materializedFolderPaths(
  entries: LibraryEntry[],
  emptyFolders: string[],
): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    for (const a of ancestors(e.parentPath)) set.add(a);
  }
  for (const p of emptyFolders) {
    // Empty-folder paths might themselves not yet be materialized via a
    // diagram, but their parents need to be in the tree too.
    for (const a of ancestors(p)) set.add(a);
  }
  return Array.from(set).sort();
}

/**
 * Builds the recursive tree shape from a list of folder paths.
 * Children at each level are sorted by their final segment (case-
 * insensitive, locale-aware).
 */
export function buildTree(paths: string[]): TreeNode[] {
  // Map by path so we can wire up children without quadratic lookups.
  const byPath = new Map<string, TreeNode>();
  for (const p of paths) {
    if (!p) continue;
    const segs = p.split("/");
    byPath.set(p, {
      path: p,
      name: segs[segs.length - 1]!,
      depth: segs.length - 1,
      children: [],
    });
  }

  const roots: TreeNode[] = [];
  for (const node of byPath.values()) {
    if (node.depth === 0) {
      roots.push(node);
      continue;
    }
    const parentPath = node.path.slice(0, node.path.lastIndexOf("/"));
    const parent = byPath.get(parentPath);
    if (parent) parent.children.push(node);
    else roots.push(node); // shouldn't happen given materializedFolderPaths,
                           // but failsafe so an orphan doesn't disappear.
  }

  const cmp = (a: TreeNode, b: TreeNode) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  const sortAll = (nodes: TreeNode[]): void => {
    nodes.sort(cmp);
    for (const n of nodes) sortAll(n.children);
  };
  sortAll(roots);
  return roots;
}

/**
 * Returns the entries that live DIRECTLY in `folderPath` (no descendants).
 * Empty string = workspace root, so this returns entries with
 * `parentPath === ""`.
 */
export function entriesAtPath(
  entries: LibraryEntry[],
  folderPath: string,
): LibraryEntry[] {
  return entries.filter((e) => e.parentPath === folderPath);
}

/**
 * Returns the entries under `folderPath` INCLUDING descendants. Used by
 * the selected-folder scoping in the All section.
 *
 * Empty `folderPath` returns ALL entries (workspace root scope = no
 * scope).
 */
export function entriesUnderPath(
  entries: LibraryEntry[],
  folderPath: string,
): LibraryEntry[] {
  if (!folderPath) return entries;
  return entries.filter(
    (e) => e.parentPath === folderPath || e.parentPath.startsWith(folderPath + "/"),
  );
}

/**
 * True iff `descendant` is a descendant of `ancestor` (or equal).
 * Used by the drag-drop reject rule: can't drop a folder onto itself
 * or any of its own descendants (would create a cycle).
 *
 * Special case: ancestor === "" matches every path (root is everyone's
 * ancestor). This is correct for the drag-drop guard — dropping into
 * the root is always legal — but means callers should check the
 * ancestor explicitly when "is the same node" matters.
 */
export function isDescendantOrEqual(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  if (!ancestor) return true; // root contains everything
  return descendant.startsWith(ancestor + "/");
}
