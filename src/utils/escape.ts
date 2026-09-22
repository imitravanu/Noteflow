/**
 * Global Escape priority cascade. Escape always unwinds exactly one layer,
 * highest-precedence surface first:
 *
 *   confirm dialog → shortcuts modal → popover → editor → selection → sidebar
 *
 * Pure so the ordering is unit-testable; `useKeyboardShortcuts` maps the
 * returned action onto the store mutations.
 */
export interface EscapeState {
  /** ConfirmDialog is open — it swallows Escape itself. */
  confirmOpen: boolean;
  shortcutsOpen: boolean;
  /** A color/tag picker popover is open (inside the editor or selection bar). */
  popoverOpen: boolean;
  /** The note editor is open. */
  editorOpen: boolean;
  hasSelection: boolean;
  sidebarOpen: boolean;
}

export type EscapeAction =
  | "none"
  | "close-shortcuts"
  | "close-popover"
  | "close-editor"
  | "clear-selection"
  | "close-sidebar";

export function escapeAction(s: EscapeState): EscapeAction {
  if (s.confirmOpen) return "none"; // the dialog's own handler closes it
  if (s.shortcutsOpen) return "close-shortcuts";
  if (s.popoverOpen) return "close-popover"; // dismiss picker first, keep editor
  if (s.editorOpen) return "close-editor";
  if (s.hasSelection) return "clear-selection";
  if (s.sidebarOpen) return "close-sidebar";
  return "none";
}
