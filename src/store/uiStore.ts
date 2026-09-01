import { create } from "zustand";
import type { NoteView, Theme } from "../types";
import { UndoStack, expandRangeSelection } from "../utils/undoStack";
import { api } from "../services/api";

export interface SnackbarState {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
}

export interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

let snackbarSeq = 1;

interface UiState {
  page: "notes" | "settings";
  view: NoteView;
  activeTagId: string | null;
  query: string;
  /** Ordered ids of selected note cards. */
  selection: string[];
  anchorId: string | null;
  editorNoteId: string | null;
  /** Local snapshot of the note being edited, kept current by the editor. */
  editorNote: import("../types").Note | null;
  /** Flush callback registered by the open editor (Ctrl+S / close). */
  editorFlush: (() => Promise<void>) | null;
  snackbar: SnackbarState | null;
  confirm: ConfirmConfig | null;
  theme: Theme;
  /** Off-canvas sidebar visibility on narrow windows. */
  sidebarOpen: boolean;
  /** Shortcuts help dialog visibility. */
  shortcutsOpen: boolean;
  undoStack: UndoStack;

  setPage: (page: "notes" | "settings") => void;
  setView: (view: NoteView) => void;
  setActiveTag: (tagId: string | null) => void;
  setQuery: (query: string) => void;

  openEditor: (noteId: string) => void;
  closeEditor: () => void;
  setEditorNote: (note: import("../types").Note | null) => void;
  registerEditorFlush: (fn: (() => Promise<void>) | null) => void;
  flushEditor: () => Promise<void>;
  /** Flushes pending editor edits (if any) and closes the editor. */
  flushAndCloseEditor: () => Promise<void>;

  toggleSelect: (
    id: string,
    mode: { ctrl: boolean; shift: boolean },
    orderedIds: string[],
  ) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;

  showSnackbar: (
    message: string,
    opts?: { actionLabel?: string; action?: () => void; undoId?: number },
  ) => void;
  hideSnackbar: () => void;
  askConfirm: (config: ConfirmConfig) => void;
  closeConfirm: () => void;

  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  initTheme: () => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;

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
  editorNote: null,
  editorFlush: null,
  snackbar: null,
  confirm: null,
  theme: "system",
  sidebarOpen: false,
  shortcutsOpen: false,
  undoStack: new UndoStack(50),

  setPage: (page) => set({ page, selection: [], anchorId: null }),

  setView: (view) =>
    set({ view, activeTagId: null, selection: [], anchorId: null, page: "notes" }),

  setActiveTag: (tagId) =>
    set({ activeTagId: tagId, view: "all", selection: [], anchorId: null, page: "notes" }),

  setQuery: (query) => set({ query }),

  openEditor: (noteId) =>
    set({ editorNoteId: noteId, selection: [], anchorId: null }),
  closeEditor: () =>
    set({ editorNoteId: null, editorNote: null, editorFlush: null }),
  setEditorNote: (note) => set({ editorNote: note }),

  registerEditorFlush: (fn) => set({ editorFlush: fn }),

  flushEditor: async () => {
    const flush = get().editorFlush;
    if (flush) await flush();
  },

  flushAndCloseEditor: async () => {
    await get().flushEditor();
    get().closeEditor();
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

  selectAll: (ids) => set({ selection: [...ids], anchorId: ids[0] ?? null }),

  showSnackbar: (message, opts) => {
    const undoId = opts?.undoId;
    set({
      snackbar: {
        id: snackbarSeq++,
        message,
        actionLabel: opts?.actionLabel,
        action: undoId != null ? () => void get().undoById(undoId) : opts?.action,
      },
    });
  },
  hideSnackbar: () => set({ snackbar: null }),

  askConfirm: (config) => set({ confirm: config }),
  closeConfirm: () => set({ confirm: null }),

  setTheme: (theme) => {
    set({ theme });
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
    } catch {
      set({ theme: "system" });
    }
  },

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  registerUndo: (label, undo) => {
    return get().undoStack.push({ label, undo });
  },

  undoById: async (id) => {
    const entry = get().undoStack.removeById(id);
    if (!entry) return;
    await entry.undo();
    get().showSnackbar(`Undid: ${entry.label}`);
  },

  undo: async () => {
    const entry = get().undoStack.pop();
    if (!entry) return;
    await entry.undo();
    get().showSnackbar(`Undid: ${entry.label}`);
  },
}));

export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

