import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { toastError, toastInfo, toastSuccess } from "../../lib/toast";

/**
 * FolderActions has two render modes selected by the `kind` prop:
 *
 *   - "new-folder"  — a + New folder button at the top of the tree.
 *                     On click, swaps to an inline input; Enter calls
 *                     POST /api/folders/empty.
 *
 *   - "folder-menu" — a per-row ⋯ menu. Renames or deletes the folder
 *                     identified by `path`. Delete cascades when the
 *                     folder has children; the user confirms via the
 *                     native `confirm()` dialog (good enough for the
 *                     epic — a polished modal is a separate concern).
 *
 * Both shapes share a single component so the menu and the new-folder
 * affordance use consistent style hooks (.library-folder-menu, etc.).
 *
 * Issue #7 Wave 2C.
 */
interface FolderActionsBase {
  /** Called after a server mutation so the Library + tree can re-fetch. */
  onFoldersChanged: () => void;
}

interface NewFolderProps extends FolderActionsBase {
  kind: "new-folder";
}

interface FolderMenuProps extends FolderActionsBase {
  kind: "folder-menu";
  path: string;
  /** Number of diagrams under this folder (including descendants). */
  subtreeCount: number;
}

export type FolderActionsProps = NewFolderProps | FolderMenuProps;

export function FolderActions(props: FolderActionsProps) {
  if (props.kind === "new-folder") return <NewFolder {...props} />;
  return <FolderMenu {...props} />;
}

// ────────────────────────────────────────────────────────────────────────
// + New folder
// ────────────────────────────────────────────────────────────────────────

function NewFolder({ onFoldersChanged }: NewFolderProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit(): Promise<void> {
    const path = value.trim();
    if (!path) {
      setEditing(false);
      setValue("");
      return;
    }
    setBusy(true);
    try {
      await api.emptyFolder(path, "add");
      toastSuccess(`Created folder ${path}`);
      onFoldersChanged();
      setEditing(false);
      setValue("");
    } catch (err) {
      toastError(
        `Couldn't create folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-tree-new-folder" data-testid="library-tree-new-folder">
      {editing ? (
        <div className="library-tree-new-folder-input-row">
          <input
            ref={inputRef}
            className="library-tree-new-folder-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              else if (e.key === "Escape") {
                setEditing(false);
                setValue("");
              }
            }}
            placeholder="folder/path"
            disabled={busy}
            data-testid="library-tree-new-folder-input"
          />
          <button
            type="button"
            onClick={() => void commit()}
            disabled={busy}
            className="library-tree-new-folder-confirm"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
            disabled={busy}
            className="library-tree-new-folder-cancel"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="library-tree-new-folder-button"
          onClick={() => setEditing(true)}
          data-testid="library-tree-new-folder-button"
        >
          + New folder
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Per-folder ⋯ menu (Rename / Delete empty / Delete cascade)
// ────────────────────────────────────────────────────────────────────────

function FolderMenu({ path, subtreeCount, onFoldersChanged }: FolderMenuProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function commitRename(): Promise<void> {
    const to = renameValue.trim();
    if (!to || to === path) {
      setRenaming(false);
      setRenameValue("");
      return;
    }
    setBusy(true);
    try {
      const res = await api.renameFolder(path, to);
      toastSuccess(
        `Renamed ${path} → ${to}${res.affected > 0 ? ` (${res.affected} diagram${res.affected === 1 ? "" : "s"} updated)` : ""}`,
      );
      onFoldersChanged();
      setRenaming(false);
      setRenameValue("");
    } catch (err) {
      toastError(
        `Rename failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteEmpty(): Promise<void> {
    setOpen(false);
    setBusy(true);
    try {
      // emptyFolder(remove) clears the entry from
      // workspaces.settings.emptyFolders. dbDeleteFolder isn't needed
      // when there are no diagrams to delete.
      await api.emptyFolder(path, "remove");
      toastSuccess(`Removed empty folder ${path}`);
      onFoldersChanged();
    } catch (err) {
      toastError(
        `Couldn't delete folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteCascade(): Promise<void> {
    setOpen(false);
    const ok =
      typeof window !== "undefined"
        ? window.confirm(
            `Delete ${subtreeCount} diagram${subtreeCount === 1 ? "" : "s"} under ${path}? This cannot be undone.`,
          )
        : true;
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.deleteFolder(path, true);
      toastInfo(`Deleted ${res.deleted} diagram${res.deleted === 1 ? "" : "s"}`);
      onFoldersChanged();
    } catch (err) {
      toastError(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (renaming) {
    return (
      <div className="library-folder-rename-row" data-testid={`library-folder-rename-${path}`}>
        <input
          ref={inputRef}
          className="library-folder-rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitRename();
            else if (e.key === "Escape") {
              setRenaming(false);
              setRenameValue("");
            }
          }}
          disabled={busy}
          placeholder={path}
        />
        <button
          type="button"
          className="library-folder-rename-confirm"
          onClick={() => void commitRename()}
          disabled={busy}
        >
          Save
        </button>
        <button
          type="button"
          className="library-folder-rename-cancel"
          onClick={() => {
            setRenaming(false);
            setRenameValue("");
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="library-folder-menu" ref={menuRef}>
      <button
        type="button"
        className="library-folder-menu-trigger"
        aria-label={`Actions for folder ${path}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={busy}
        data-testid={`library-folder-menu-${path}`}
      >
        ⋯
      </button>
      {open && (
        <div className="library-folder-menu-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameValue(path);
              setRenaming(true);
              setOpen(false);
            }}
          >
            Rename…
          </button>
          {subtreeCount === 0 ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void deleteEmpty()}
              data-testid={`library-folder-delete-empty-${path}`}
            >
              Delete empty folder
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="library-folder-menu-danger"
              onClick={() => void deleteCascade()}
              data-testid={`library-folder-delete-cascade-${path}`}
            >
              Delete folder + {subtreeCount} diagram{subtreeCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
