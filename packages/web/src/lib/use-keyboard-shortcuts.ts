import { useEffect } from "react";
import { useAppStore } from "../store";
import { api } from "./api";
import { isTypingTarget } from "./shortcuts";

/**
 * Issue #10 — single, app-wide keyboard handler. Registered once at the App
 * boundary so it lives for the entire workspace session.
 *
 * Key rules:
 *  - Never fire when the user is typing into an input/textarea/contenteditable.
 *  - Modifier matching is strict: `Cmd/Ctrl + K` requires the modifier flag,
 *    and a stray `K` keypress alone does NOT open the palette.
 *  - The handler must always preventDefault on shortcuts it consumes, so the
 *    browser doesn't also navigate / scroll / open a save dialog.
 *  - Esc closes whichever surface is open, in priority order.
 *
 * The handler is intentionally non-extensible at this stage — issue #10
 * scopes the default set, and a user-customizable surface is explicitly
 * out-of-scope.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Bail out fast when typing — see lib/shortcuts.ts for the predicate.
      if (isTypingTarget(e.target)) return;

      const store = useAppStore.getState();
      const isMeta = e.metaKey || e.ctrlKey;

      // Esc — close palette → help → tile-focus → nothing.
      if (e.key === "Escape") {
        if (store.commandPaletteOpen) {
          store.setCommandPaletteOpen(false);
          e.preventDefault();
          return;
        }
        if (store.shortcutsHelpOpen) {
          store.setShortcutsHelpOpen(false);
          e.preventDefault();
          return;
        }
        if (store.focusedTileId) {
          store.setFocusedTileId(null);
          e.preventDefault();
          return;
        }
        return;
      }

      // Cmd/Ctrl + K — toggle command palette.
      if (isMeta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        store.setCommandPaletteOpen(!store.commandPaletteOpen);
        return;
      }

      // "/" — open command palette. We accept the "Slash" code as well so
      // non-US keyboards (where "/" needs a shift) still trigger.
      if (!isMeta && (e.key === "/" || e.code === "Slash") && !e.shiftKey) {
        e.preventDefault();
        store.setCommandPaletteOpen(true);
        return;
      }

      // "?" — open shortcuts help. Browsers send "?" with shift+/ on US
      // layouts; honor either signal.
      if (!isMeta && (e.key === "?" || (e.shiftKey && e.code === "Slash"))) {
        e.preventDefault();
        store.setShortcutsHelpOpen(!store.shortcutsHelpOpen);
        return;
      }

      // Cmd/Ctrl + D — duplicate focused tile.
      if (isMeta && (e.key === "d" || e.key === "D")) {
        const id = store.focusedTileId;
        if (!id) return;
        const tile = store.tiles.find((t) => t.id === id);
        if (!tile) return;
        e.preventDefault();
        const cam = store.camera;
        void api.createTile({
          diagramId: tile.diagramId,
          diagramSlug: tile.diagramSlug,
          x: tile.x + 20,
          y: tile.y + 20,
          w: tile.w,
          h: tile.h,
        }).then((res) => {
          if (res?.tile?.id) store.setFocusedTileId(res.tile.id);
        }).catch(() => {});
        return;
      }

      // Delete / Backspace — remove focused tile (don't fire on Backspace
      // when typing; the isTypingTarget guard above already handles that).
      if ((e.key === "Delete" || e.key === "Backspace") && !isMeta) {
        const id = store.focusedTileId;
        if (!id) return;
        e.preventDefault();
        store.setFocusedTileId(null);
        void api.deleteTile(id).catch(() => {});
        return;
      }

      // Arrow keys — nudge focused tile (1px / 10px with Shift).
      if (
        e.key === "ArrowUp" || e.key === "ArrowDown" ||
        e.key === "ArrowLeft" || e.key === "ArrowRight"
      ) {
        const id = store.focusedTileId;
        if (!id) return;
        const tile = store.tiles.find((t) => t.id === id);
        if (!tile) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === "ArrowUp") dy = -step;
        else if (e.key === "ArrowDown") dy = step;
        else if (e.key === "ArrowLeft") dx = -step;
        else dx = step;
        const next = { ...tile, x: tile.x + dx, y: tile.y + dy };
        store.setTiles(store.tiles.map((t) => t.id === id ? next : t));
        void api.patchTile(id, { x: next.x, y: next.y }).catch(() => {});
        return;
      }

      // G — toggle snap-to-grid.
      if (!isMeta && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        store.setSnapEnabled(!store.snapEnabled);
        return;
      }

      // M — toggle minimap.
      if (!isMeta && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        store.setMinimapVisible(!store.minimapVisible);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
