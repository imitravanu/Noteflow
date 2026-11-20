import { create } from "zustand";
import type { Note, NoteView, Theme } from "../types";
import { UndoStack, expandRangeSelection } from "../utils/undoStack";
import { api } from "../services/api";

/**
 * A popover (color/tag picker) that is currently open. The picker registers
 * itself here on mount so the global Escape handler can dismiss *only* the
 * popover instead of falling through to the editor underneath it.
 */
export interface PopoverHandle {
  id: string;
  close: () => void;
}

/** Why a toast left the screen. "action" is a click on its action button. */
export type SnackbarDismissReason = "dismissed" | "replaced" | "action";

export interface SnackbarState {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
  persistent?: boolean;
  onDismiss?: (reason: SnackbarDismissReason) => void;
}

export interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

let snackbarSeq = 1;

/** Waiting toasts beyond this many drop the oldest (a runaway backlog is
 *  never worth unbounded memory; the newest is the one users care about). */
const SNACKBAR_QUEUE_MAX = 4;

interface UiState {
  page: "notes" | "settings";
  view: NoteView;
  activeTagId: string | null;
  query: string;
  /** Ordered ids of selected note cards. */
  selection: string[];
  anchorId: string | null;
  editorNoteId: string | null;
  /** Card id the editor hands focus back to when it closes (see NoteEditor). */
  editorReturnFocusId: string | null;
  /** Committed snapshot of the open note, shared by the toolbar and shortcuts. */
  editorNote: Note | null;
  /** Flush callback for the mounted editor (Ctrl+S / close / note switch). */
  editorFlush: (() => Promise<boolean>) | null;
  snackbar: SnackbarState | null;
  /**
   * Toasts waiting their turn. A snackbar with a live affordance (Undo,
   * reminder "Open") is never silently replaced — the newcomer queues and
   * surfaces when the current one auto-hides. Capped; oldest dropped.
   */
  snackbarQueue: SnackbarState[];
  confirm: ConfirmConfig | null;
  theme: Theme;
  /** Off-canvas sidebar visibility on narrow windows. */
  sidebarOpen: boolean;
  /** Shortcuts help dialog visibility. */
  shortcutsOpen: boolean;
  /** Currently open popover, if any (see PopoverHandle). */
  openPopover: PopoverHandle | null;
  undoStack: UndoStack;

  setPage: (page: "notes" | "settings") => Promise<void>;
  setView: (view: NoteView) => void;
  setActiveTag: (tagId: string | null) => void;
  setQuery: (query: string) => void;

  /**
   * Opens a note in the editor. A currently-open editor is flushed *first*:
   * switching notes resets the save gate, which would otherwise drop edits
   * still inside the debounce window (reachable via the reminder "Open"
   * toast or a card click while another note has unsaved changes).
   */
  openEditor: (noteId: string, returnFocusId?: string | null) => Promise<boolean>;
  closeEditor: () => void;
  setEditorNote: (note: Note | null) => void;
  patchEditorNote: (id: string, patch: Partial<Omit<Note, "id">>) => void;
  registerEditorFlush: (fn: (() => Promise<boolean>) | null) => void;
  flushEditor: () => Promise<boolean>;
  /** Flushes pending editor edits (if any) and closes the editor. */
  flushAndCloseEditor: () => Promise<boolean>;

  /**
   * Reminder the user asked to open, held until the editor has actually
   * displayed that note. Until then the reminder stays in SQLite, so a failed
   * draft save or a failed note load cannot consume it.
   */
  pendingReminderAck: { noteId: string; expectedAt: number } | null;
  /**
   * Navigates to Notes and opens the reminder's note. Resolves false when the
   * previous draft could not be saved or the editor could not start opening
   * (the reminder is then left scheduled).
   */
  openReminderNote: (noteId: string, expectedAt: number) => Promise<boolean>;
  /** Editor loaded the pending note: acknowledge its reminder now. */
  completeReminderOpen: (noteId: string) => Promise<boolean>;
  /** Editor failed to load the pending note: keep the reminder scheduled. */
  cancelReminderOpen: (noteId: string) => void;

  toggleSelect: (
    id: string,
    mode: { ctrl: boolean; shift: boolean },
    orderedIds: string[],
  ) => void;
  clearSelection: () => void;
  /** Clears the selection only if it is still exactly `ids` — a bulk action
   *  finishing after the user re-selected must not wipe the new selection. */
  clearSelectionIfUnchanged: (ids: string[]) => void;
  selectAll: (ids: string[]) => void;

  showSnackbar: (
    message: string,
    opts?: {
      actionLabel?: string;
      action?: () => void;
      undoId?: number;
      /** Outcome feedback (undo results): claim the visible slot even if an
       *  actionable toast is showing — its affordance was just used, so it
       *  must not sit in front of the queue forever. */
      replace?: boolean;
      persistent?: boolean;
      onDismiss?: (reason: SnackbarDismissReason) => void;
    },
  ) => void;
  hideSnackbar: (
    expectedId?: number,
    reason?: SnackbarDismissReason,
  ) => void;
  askConfirm: (config: ConfirmConfig) => void;
  closeConfirm: () => void;

  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  initTheme: () => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  /** Called by a popover on mount; Escape closes the registered one first. */
  registerPopover: (id: string, close: () => void) => void;
  /** Called by a popover on unmount; only clears its own registration. */
  unregisterPopover: (id: string) => void;

  registerUndo: (label: string, undo: () => Promise<void> | void) => number;
  /** Reverses one specific action by its registered id (snackbar undo). */
  undoById: (id: number) => Promise<void>;
  undo: () => Promise<void>;
}

export const useUiStore = create<UiState>((set, get) => ({
  page: "notes",
  view: "all",
  activeTagId: null,
  query: "",
  selection: [],
  anchorId: null,
  editorNoteId: null,
  editorReturnFocusId: null,
  editorNote: null,
  editorFlush: null,
  pendingReminderAck: null,
  snackbar: null,
  snackbarQueue: [],
  confirm: null,
  theme: "system",
  sidebarOpen: false,
  shortcutsOpen: false,
  openPopover: null,
  undoStack: new UndoStack(50),

  setPage: async (page) => {
    // Settings replaces NotesPage, which unmounts the editor. Keep the editor
    // mounted if its latest draft could not be persisted.
    if (page === "settings" && get().editorNoteId) {
      const closed = await get().flushAndCloseEditor();
      if (!closed) return;
    }
    set({ page, selection: [], anchorId: null });
  },

  setView: (view) =>
    set({ view, activeTagId: null, selection: [], anchorId: null, page: "notes" }),

  setActiveTag: (tagId) =>
    set({ activeTagId: tagId, view: "all", selection: [], anchorId: null, page: "notes" }),

  setQuery: (query) => {
    // Search is global: starting one from Settings must bring back the page
    // that renders results. TopBar (and its input) stays mounted, so the query
    // and the caret survive the page swap. setPage owns the editor save guard.
    set({ query });
    if (query.trim() && get().page !== "notes") void get().setPage("notes");
  },

  openEditor: async (noteId, returnFocusId = null) => {
    // Must resolve before the id changes: `flushEditor` waits for in-flight
    // saves *and* their chained follow-ups, so no save of the old note can
    // land after the editor has switched to the new one.
    const saved = await get().flushEditor();
    if (!saved) return false;
    set({
      editorNoteId: noteId,
      // Switching notes inside an open editor keeps the original return
      // target; opening from a closed editor records the clicked card.
      editorReturnFocusId: get().editorNoteId
        ? get().editorReturnFocusId
        : returnFocusId,
      selection: [],
      anchorId: null,
    });
    return true;
  },
  closeEditor: () =>
    set({ editorNoteId: null, editorNote: null, pendingReminderAck: null }),
  setEditorNote: (note) => set({ editorNote: note }),
  patchEditorNote: (id, patch) =>
    set((state) =>
      state.editorNoteId === id && state.editorNote?.id === id
        ? { editorNote: { ...state.editorNote, ...patch } }
        : state,
    ),

  registerEditorFlush: (fn) => set({ editorFlush: fn }),

  flushEditor: async () => {
    const flush = get().editorFlush;
    return flush ? flush() : true;
  },

  flushAndCloseEditor: async () => {
    const saved = await get().flushEditor();
    if (!saved) return false;
    get().closeEditor();
    return true;
  },

  openReminderNote: async (noteId, expectedAt) => {
    // The editor only mounts inside NotesPage, so Settings must hand the page
    // back before the note id can be shown to the user.
    if (get().page !== "notes") {
      set({ page: "notes", selection: [], anchorId: null });
    }
    const alreadyLoaded =
      get().editorNoteId === noteId && get().editorNote?.id === noteId;
    // Register the acknowledgment *before* the editor starts loading. The
    // editor claims it only after rendering the note; a load failure cancels
    // it, leaving the reminder in SQLite for the next poll.
    set({ pendingReminderAck: { noteId, expectedAt } });
    const opened = await get().openEditor(noteId);
    if (!opened) {
      get().cancelReminderOpen(noteId);
      return false;
    }
    if (alreadyLoaded) {
      // Clicking Open on the note that is already displayed never reruns the
      // editor's load effect, so acknowledge it here.
      await get().completeReminderOpen(noteId);
    }
    return true;
  },

  completeReminderOpen: async (noteId) => {
    const pending = get().pendingReminderAck;
    if (!pending || pending.noteId !== noteId) return false;
    set({ pendingReminderAck: null });
    try {
      return await api.acknowledgeReminder(noteId, pending.expectedAt);
    } catch {
      // The schedule remains in SQLite; the reminder hook will show it again.
      return false;
    }
  },

  cancelReminderOpen: (noteId) => {
    const pending = get().pendingReminderAck;
    if (pending?.noteId === noteId) set({ pendingReminderAck: null });
  },

  toggleSelect: (id, mode, orderedIds) => {
    const { selection, anchorId } = get();
    if (mode.shift && (anchorId || selection.length > 0)) {
      const next = expandRangeSelection(
        orderedIds,
        anchorId ?? selection[selection.length - 1] ?? id,
        id,
        selection,
      );
      set({ selection: [...next] });
      return;
    }
    if (mode.ctrl || selection.length > 0) {
      const next = selection.includes(id)
        ? selection.filter((s) => s !== id)
        : [...selection, id];
      set({ selection: next, anchorId: id });
      return;
    }
    set({ selection: [id], anchorId: id });
  },

  clearSelection: () => set({ selection: [], anchorId: null }),

  clearSelectionIfUnchanged: (ids) => {
    const { selection } = get();
    if (
      selection.length === ids.length &&
      ids.every((id, i) => selection[i] === id)
    ) {
      set({ selection: [], anchorId: null });
    }
  },

  selectAll: (ids) => set({ selection: [...ids], anchorId: ids[0] ?? null }),

  showSnackbar: (message, opts) => {
    const undoId = opts?.undoId;
    const entry: SnackbarState = {
      id: snackbarSeq++,
      message,
      actionLabel: opts?.actionLabel,
      action: undoId != null ? () => void get().undoById(undoId) : opts?.action,
      persistent: opts?.persistent,
      onDismiss: opts?.onDismiss,
    };
    // A visible toast whose affordance is still live (Undo, reminder "Open")
    // is never overwritten: the newcomer waits its turn instead. A toast with
    // no action carries nothing to lose, so it is replaced outright — and
    // outcome feedback (`replace`, e.g. "Undid: …") always takes the slot,
    // because the clicked toast hid itself before this call ran.
    const current = get().snackbar;
    if (current?.action && !opts?.replace) {
      const queue = [...get().snackbarQueue, entry];
      const dropped = queue.splice(0, Math.max(0, queue.length - SNACKBAR_QUEUE_MAX));
      set({ snackbarQueue: queue });
      dropped.forEach((item) => item.onDismiss?.("replaced"));
    } else {
      set({ snackbar: entry });
      current?.onDismiss?.("replaced");
    }
  },
  hideSnackbar: (expectedId, reason = "dismissed") => {
    // Auto-hide / manual dismiss advances the queue, so a protected toast's
    // replacement surfaces instead of being lost.
    const current = get().snackbar;
    if (expectedId !== undefined && current?.id !== expectedId) return;
    const [next, ...rest] = get().snackbarQueue;
    set({ snackbar: next ?? null, snackbarQueue: rest });
    current?.onDismiss?.(reason);
  },

  askConfirm: (config) => set({ confirm: config }),
  closeConfirm: () => set({ confirm: null }),

  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem("noteflow-theme", theme);
    } catch {
      /* private mode: in-session theme still applies */
    }
    api.setSetting("theme", theme).catch(() => {
      /* theme persistence is best-effort; the in-session theme still applies */
    });
  },

  cycleTheme: () => {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(get().theme) + 1) % order.length];
    get().setTheme(next);
  },

  initTheme: async () => {
    try {
      const stored = await api.getSetting("theme");
      const theme =
        stored === "light" || stored === "dark" || stored === "system"
          ? stored
          : "system";
      set({ theme });
      try {
        localStorage.setItem("noteflow-theme", theme);
      } catch {
        /* ignore */
      }
    } catch {
      try {
        const local = localStorage.getItem("noteflow-theme");
        if (local === "light" || local === "dark" || local === "system") {
          set({ theme: local });
          return;
        }
      } catch {
        /* ignore */
      }
      set({ theme: "system" });
    }
  },

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  registerPopover: (id, close) => set({ openPopover: { id, close } }),
  unregisterPopover: (id) => {
    // Only clear our own registration — a stale unmount must not hide
    // another popover that registered in the meantime.
    if (get().openPopover?.id === id) set({ openPopover: null });
  },

  registerUndo: (label, undo) => {
    return get().undoStack.push({ label, undo });
  },

  undoById: async (id) => {
    const entry = get().undoStack.removeById(id);
    if (!entry) {
      // Yield once: the snackbar button hides the current snackbar right
      // after this action starts, so our replacement message must come after.
      await Promise.resolve();
      get().showSnackbar("That action can no longer be undone.", { replace: true });
      return;
    }
    try {
      await entry.undo();
      get().showSnackbar(`Undid: ${entry.label}`, { replace: true });
    } catch (error) {
      get().undoStack.restore(entry);
      get().showSnackbar(`Could not undo: ${errText(error)}`, {
        replace: true,
        actionLabel: "Retry",
        undoId: entry.id,
      });
    }
  },

  undo: async () => {
    const entry = get().undoStack.pop();
    if (!entry) {
      get().showSnackbar("Nothing to undo.");
      return;
    }
    try {
      await entry.undo();
      get().showSnackbar(`Undid: ${entry.label}`, { replace: true });
    } catch (error) {
      get().undoStack.restore(entry);
      get().showSnackbar(`Could not undo: ${errText(error)}`, {
        replace: true,
        actionLabel: "Retry",
        undoId: entry.id,
      });
    }
  },
}));

export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
