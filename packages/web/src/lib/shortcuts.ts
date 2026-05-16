/**
 * Helpers shared between the keyboard-shortcut hook and the shortcuts-help
 * modal. Kept dependency-free so they're unit-testable in isolation.
 */

/**
 * Returns true when the user is currently typing into an input, textarea,
 * or contenteditable element. Used by every keyboard handler to bail out
 * before firing global shortcuts — typing "k" in the Library search box
 * must NOT open the command palette.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * True when the event originated from a contenteditable host or matches an
 * input/textarea/select tag. A separate convenience over isTypingTarget that
 * checks document.activeElement so call-sites can decide without holding the
 * KeyboardEvent.
 */
export function isTypingInDocument(doc: Document = document): boolean {
  return isTypingTarget(doc.activeElement);
}

export interface ShortcutDef {
  /** Display string, e.g. "Cmd/Ctrl + K". */
  keys: string;
  /** Short description for the help modal. */
  description: string;
  /** Grouping label, e.g. "Navigation", "Editing", "Palette". */
  group: string;
}

/** Canonical list of shortcuts the help modal renders. */
export const SHORTCUTS: ShortcutDef[] = [
  { keys: "?", description: "Show this shortcuts cheat-sheet", group: "Help" },
  { keys: "Esc", description: "Close dialog or modal", group: "Help" },
  { keys: "/", description: "Open command palette", group: "Palette" },
  { keys: "Cmd/Ctrl + K", description: "Open command palette", group: "Palette" },
  { keys: "Cmd/Ctrl + D", description: "Duplicate focused tile", group: "Editing" },
  { keys: "Delete / Backspace", description: "Remove focused tile", group: "Editing" },
  { keys: "Arrow keys", description: "Nudge focused tile by 1 px", group: "Editing" },
  { keys: "Shift + Arrow keys", description: "Nudge focused tile by 10 px", group: "Editing" },
  { keys: "Shift (while dragging)", description: "Temporarily invert snap-to-grid", group: "Editing" },
  { keys: "M", description: "Toggle minimap", group: "View" },
  { keys: "G", description: "Toggle snap-to-grid", group: "View" },
];
