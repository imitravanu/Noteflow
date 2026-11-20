import type { NoteView } from "../types";

export interface CreateActionContext {
  page: "notes" | "settings";
  view: NoteView;
  query: string;
  activeTagId: string | null;
  /** Count of *active* notes — archived and trashed notes are excluded. */
  totalNotes: number;
}

/**
 * Whether the global New Note action belongs in the top bar.
 *
 * Only one screen provides its own create affordance: the empty All Notes
 * library ("Create your first note"). Every other screen — Archive, Trash,
 * Favorites, an empty tag view, an empty search result, and Settings — must
 * keep the global action. The active-note count cannot decide this on its own:
 * it is zero when the last active note was archived even though Archive still
 * has notes and offers no create button of its own.
 */
export function shouldShowNewNote(ctx: CreateActionContext): boolean {
  if (ctx.page === "settings") return true;
  if (ctx.query.trim()) return true;
  if (ctx.view !== "all") return true;
  if (ctx.activeTagId) return true;
  // Empty All Notes already shows exactly one "Create your first note" action.
  return ctx.totalNotes > 0;
}
