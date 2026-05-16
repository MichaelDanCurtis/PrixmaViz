import { useAppStore } from "../store";
import { SHORTCUTS } from "../lib/shortcuts";

/**
 * Issue #10 — shortcuts cheat-sheet. Opened with "?", closed with Esc or by
 * clicking outside. Lists every shortcut grouped by category.
 */
export function ShortcutsHelp() {
  const open = useAppStore((s) => s.shortcutsHelpOpen);
  const setOpen = useAppStore((s) => s.setShortcutsHelpOpen);
  if (!open) return null;

  // Group shortcuts by their `group` field for readable rendering.
  const groups = new Map<string, typeof SHORTCUTS>();
  for (const s of SHORTCUTS) {
    const list = groups.get(s.group) ?? [];
    list.push(s);
    groups.set(s.group, list);
  }

  return (
    <div
      className="shortcuts-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="shortcuts-panel" role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <button
            className="shortcuts-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="shortcuts-body">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group} className="shortcuts-group">
              <h3>{group}</h3>
              <dl>
                {items.map((s, idx) => (
                  <div key={`${group}-${idx}`} className="shortcuts-row">
                    <dt><kbd>{s.keys}</kbd></dt>
                    <dd>{s.description}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="shortcuts-foot">
          Press <kbd>Esc</kbd> to close.
        </div>
      </div>
    </div>
  );
}
