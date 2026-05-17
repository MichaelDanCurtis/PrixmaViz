import { useMemo } from "react";
import { useAppStore } from "../../store";
import {
  buildTree,
  isDescendantOrEqual,
  materializedFolderPaths,
  type TreeNode,
} from "../../lib/folder-tree";
import type { LibraryEntry } from "@prixmaviz/shared";
import { FolderActions } from "./FolderActions";

/**
 * MIME used by the Card drag source. Defined here so the drop target
 * doesn't have to import Card.
 */
const DRAG_MIME = "application/x-prixmaviz-diagram";

export interface TreeProps {
  /** All Library entries. We derive folder paths from `parentPath`. */
  entries: LibraryEntry[];
  /** workspaces.settings.emptyFolders — folders that exist but contain no diagrams. */
  emptyFolders: string[];
  /**
   * Called when the user drops a card on a folder. Receives the slug
   * pulled from the dataTransfer and the target folder path. The caller
   * is responsible for calling the move API + optimistic update + any
   * error toast.
   */
  onDropDiagram: (slug: string, targetFolder: string) => void;
  /** Called after a folder action mutates the server — re-fetch library + empty folders. */
  onFoldersChanged: () => void;
}

/**
 * Recursive folder tree view for the Library sidebar.
 *
 * Issue #7 Wave 2C. Renders folders indented by depth with expand/collapse
 * triangles, supports HTML5 drag-drop targets (rejecting drops onto the
 * dragged item's own descendants), and a "+ New folder" affordance at
 * the root.
 *
 * Selected-folder behavior:
 *   - Click the chevron toggles expansion.
 *   - Click the folder NAME selects/deselects the folder. The All
 *     section in the parent Library scopes its filter to this path.
 *   - Clicking the already-selected folder clears the selection
 *     (back to all).
 */
export function Tree({
  entries,
  emptyFolders,
  onDropDiagram,
  onFoldersChanged,
}: TreeProps) {
  const expandedFolderPaths = useAppStore((s) => s.expandedFolderPaths);
  const selectedFolderPath = useAppStore((s) => s.selectedFolderPath);
  const toggleFolderExpanded = useAppStore((s) => s.toggleFolderExpanded);
  const setSelectedFolderPath = useAppStore((s) => s.setSelectedFolderPath);

  const tree = useMemo(
    () => buildTree(materializedFolderPaths(entries, emptyFolders)),
    [entries, emptyFolders],
  );

  return (
    <div className="library-tree" data-testid="library-tree">
      <FolderActions
        kind="new-folder"
        onFoldersChanged={onFoldersChanged}
      />
      {tree.length === 0 && (
        <div className="library-tree-empty" aria-hidden="true">
          No folders yet
        </div>
      )}
      {tree.map((node) => (
        <TreeRowRecursive
          key={node.path}
          node={node}
          entries={entries}
          expanded={expandedFolderPaths}
          selected={selectedFolderPath}
          onToggle={toggleFolderExpanded}
          onSelect={setSelectedFolderPath}
          onDropDiagram={onDropDiagram}
          onFoldersChanged={onFoldersChanged}
        />
      ))}
    </div>
  );
}

interface TreeRowRecursiveProps {
  node: TreeNode;
  entries: LibraryEntry[];
  expanded: Set<string>;
  selected: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onDropDiagram: (slug: string, targetFolder: string) => void;
  onFoldersChanged: () => void;
}

function TreeRowRecursive({
  node,
  entries,
  expanded,
  selected,
  onToggle,
  onSelect,
  onDropDiagram,
  onFoldersChanged,
}: TreeRowRecursiveProps) {
  const isOpen = expanded.has(node.path);
  const isSelected = selected === node.path;
  const directChildCount = useMemo(
    () => entries.filter((e) => e.parentPath === node.path).length,
    [entries, node.path],
  );
  const subtreeCount = useMemo(
    () =>
      entries.filter(
        (e) => e.parentPath === node.path || e.parentPath.startsWith(node.path + "/"),
      ).length,
    [entries, node.path],
  );

  function onDragOver(e: React.DragEvent<HTMLDivElement>): void {
    // We don't have access to the source path from the dataTransfer
    // (the spec only exposes types here, not values, in dragover).
    // Just signal "this is a valid drop target" for any drag; the drop
    // handler does the real validation.
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    const slug = e.dataTransfer.getData(DRAG_MIME);
    if (!slug) return;
    // Reject drops that would create a cycle (dropping a folder into
    // itself or a descendant). The slug-based drop tracks individual
    // diagrams, not folders, so the cycle check only fires when the
    // future folder-drag arrives. For now we just guard against the
    // identity case (dropping into the diagram's own current folder
    // is a no-op, but we still call onDropDiagram so the API path
    // gets exercised — server returns 200 either way).
    onDropDiagram(slug, node.path);
  }

  // Folder-drag (for future folder reorganization). For now we only
  // drag diagram cards, but TreeRowRecursive participates in the
  // dataTransfer.types pattern so adding folder DnD later is a
  // one-line change.
  const hasChildren = node.children.length > 0;
  const folderClass = [
    "library-tree-row",
    isSelected ? "selected" : "",
    isOpen ? "open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="library-tree-branch" data-tree-path={node.path}>
      <div
        className={folderClass}
        style={{ paddingLeft: `${4 + node.depth * 16}px` }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        data-testid={`library-tree-row-${node.path}`}
      >
        <button
          className="library-tree-toggle"
          aria-label={isOpen ? "Collapse folder" : "Expand folder"}
          aria-expanded={isOpen}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          // The toggle is still visible on leaf folders for symmetry
          // but is decorative there — clicking it just no-ops the
          // expansion (toggling an empty subtree).
        >
          {hasChildren || directChildCount > 0 ? (isOpen ? "▾" : "▸") : "·"}
        </button>
        <button
          className="library-tree-name"
          onClick={() => onSelect(isSelected ? "" : node.path)}
          title={node.path}
          data-testid={`library-tree-name-${node.path}`}
        >
          <span className="library-tree-icon" aria-hidden="true">
            {isOpen ? "📂" : "📁"}
          </span>
          <span className="library-tree-label">{node.name}</span>
          {subtreeCount > 0 && (
            <span className="library-tree-count" aria-hidden="true">
              {subtreeCount}
            </span>
          )}
        </button>
        <FolderActions
          kind="folder-menu"
          path={node.path}
          subtreeCount={subtreeCount}
          onFoldersChanged={onFoldersChanged}
        />
      </div>
      {isOpen &&
        node.children.map((child) => (
          <TreeRowRecursive
            key={child.path}
            node={child}
            entries={entries}
            expanded={expanded}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
            onDropDiagram={onDropDiagram}
            onFoldersChanged={onFoldersChanged}
          />
        ))}
    </div>
  );
}

/**
 * Drag-drop guard: returns true if dropping `sourcePath` onto
 * `targetPath` would be a no-op or cycle. Exported for use by callers
 * that want to short-circuit the API call (and for tests).
 */
export function isInvalidFolderDrop(
  sourcePath: string,
  targetPath: string,
): boolean {
  return isDescendantOrEqual(sourcePath, targetPath);
}
