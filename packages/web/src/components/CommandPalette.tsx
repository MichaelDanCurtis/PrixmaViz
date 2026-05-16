import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import { buildCommands, type PaletteCommand } from "../lib/commands";
import { fuzzyFilter } from "../lib/fuzzy";

/**
 * Issue #10 — command palette. Cmd/Ctrl-K opens; "/" also opens. Arrow keys
 * change selection, Enter runs the highlighted command, Esc closes.
 *
 * Kept dependency-free: a simple substring fuzzy filter is enough at this
 * scale (~a dozen commands). When the command count grows past ~50 we can
 * swap in a smarter ranker without touching this component's shape.
 */
export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo<PaletteCommand[]>(() => buildCommands(), []);

  const filtered = useMemo(() => fuzzyFilter(commands, query), [commands, query]);

  // Reset internal state every time the palette opens so each invocation
  // starts on the first command with a clean query.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      // Focus the input on next tick so the autofocus actually wins over
      // whatever stole focus before opening (e.g. the page's body).
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Clamp the cursor inside the filtered list so navigation never points at
  // a phantom command.
  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered, selectedIdx]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIdx]?.item;
      if (cmd) {
        setOpen(false);
        void cmd.run();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        // Click outside closes the palette. The check guards against the
        // common "click inside but mousedown started outside" case.
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="palette-panel" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <ul className="palette-list" role="listbox">
          {filtered.length === 0 && (
            <li className="palette-empty">No commands match "{query}"</li>
          )}
          {filtered.map((res, idx) => (
            <li
              key={res.item.id}
              className={`palette-item${idx === selectedIdx ? " selected" : ""}`}
              role="option"
              aria-selected={idx === selectedIdx}
              onMouseEnter={() => setSelectedIdx(idx)}
              onClick={() => {
                setOpen(false);
                void res.item.run();
              }}
            >
              <span className="palette-name">{res.item.name}</span>
              {res.item.hint && <span className="palette-hint">{res.item.hint}</span>}
            </li>
          ))}
        </ul>
        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
