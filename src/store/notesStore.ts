import { create } from "zustand";
import type { Counts, FlagPatch, Note, NotePatch, Tag } from "../types";
import { api } from "../services/api";
import { errText, useUiStore } from "./uiStore";

/** Monotonic token so stale async list results never overwrite fresh ones. */
let requestSeq = 0;

interface NotesState {
  notes: Note[];
  tags: Tag[];
  counts: Counts;
  loading: boolean;

  refresh: () => Promise<void>;
  createNote: () => Promise<void>;
  updateNote: (id: string, patch: NotePatch) => Promise<Note | null>;
  setFlags: (id: string, flags: FlagPatch) => Promise<Note | null>;
  setFlagsForSelection: (flags: FlagPatch) => Promise<void>;
  trashNotes: (ids: string[]) => Promise<void>;
  trashSelection: () => Promise<void>;
  restoreNotes: (ids: string[]) => Promise<void>;
  deletePermanent: (ids: string[]) => Promise<void>;
  emptyTrash: () => Promise<void>;
  setNoteTags: (noteId: string, tagIds: string[]) => Promise<void>;
  createTag: (name: string) => Promise<Tag | null>;
  deleteTag: (tagId: string) => Promise<void>;
  renameTag: (tagId: string, name: string) => Promise<void>;
}

function noteCountLabel(n: number): string {
  return n === 1 ? "Note moved to Trash" : `${n} notes moved to Trash`;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  tags: [],
  counts: { all: 0, pinned: 0, favorites: 0, archived: 0, trash: 0 },
  loading: true,

  refresh: async () => {
    const ui = useUiStore.getState();
    const token = ++requestSeq;
    try {
      const [notes, tags, counts] = await Promise.all([
        api.listNotes(ui.view, ui.activeTagId, ui.query),
        api.listTags(),
        api.getCounts(),
      ]);
      if (token !== requestSeq) return; // a newer request superseded this one
      set({ notes, tags, counts, loading: false });
    } catch (e) {
      if (token !== requestSeq) return;
      set({ loading: false });
      ui.showSnackbar(errText(e));
    }
  },

  createNote: async () => {
    const ui = useUiStore.getState();
    try {
      const note = await api.createNote();
      await get().refresh();
      ui.openEditor(note.id);
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  updateNote: async (id, patch) => {
    try {
      const updated = await api.updateNote(id, patch);
      set({
        notes: get().notes.map((n) => (n.id === id ? updated : n)),
      });
      return updated;
    } catch {
      return null;
    }
  },

  /** Updates flags and returns the updated note (or null on failure). */
  setFlags: async (id, flags) => {
    const ui = useUiStore.getState();
    const before = get().notes.find((n) => n.id === id);
    try {
      const updated = await api.setFlags(id, flags);
      set({ notes: get().notes.map((n) => (n.id === id ? updated : n)) });
      await get().refresh();
      if (flags.pinned !== undefined && before) {
        const label = flags.pinned ? "Pin note" : "Unpin note";
        ui.registerUndo(label, async () => {
          await api.setFlags(id, { pinned: before.pinned });
          await get().refresh();
        });
      }
      if (flags.favorite !== undefined && before) {
        const label = flags.favorite ? "Favorite note" : "Unfavorite note";
        ui.registerUndo(label, async () => {
          await api.setFlags(id, { favorite: before.favorite });
          await get().refresh();
        });
      }
      if (flags.archived !== undefined && before) {
        const label = flags.archived ? "Archive note" : "Unarchive note";
        const undoId = ui.registerUndo(label, async () => {
          await api.setFlags(id, { archived: before.archived });
          await get().refresh();
        });
        ui.showSnackbar(flags.archived ? "Note archived" : "Note restored to notes", {
          actionLabel: "Undo",
          undoId,
        });
      }
      return updated;
    } catch (e) {
      ui.showSnackbar(errText(e));
      return null;
    }
  },

  setFlagsForSelection: async (flags) => {
    const ui = useUiStore.getState();
    const ids = [...ui.selection];
    if (!ids.length) return;
    const before = new Map(
      get()
        .notes.filter((n) => ids.includes(n.id))
        .map((n) => [n.id, n] as const),
    );
    try {
      await Promise.all(ids.map((id) => api.setFlags(id, flags)));
      ui.clearSelection();
      await get().refresh();
      const label =
        flags.pinned !== undefined
          ? flags.pinned
            ? `Pin ${ids.length} notes`
            : `Unpin ${ids.length} notes`
          : flags.favorite !== undefined
            ? flags.favorite
              ? `Favorite ${ids.length} notes`
              : `Unfavorite ${ids.length} notes`
            : flags.archived !== undefined
              ? flags.archived
                ? `Archive ${ids.length} notes`
                : `Unarchive ${ids.length} notes`
              : `Update ${ids.length} notes`;
      const undoId = ui.registerUndo(label, async () => {
        await Promise.all(
          ids.map((id) => {
            const prev = before.get(id);
            return api.setFlags(id, {
              pinned: flags.pinned !== undefined ? prev?.pinned : undefined,
              favorite: flags.favorite !== undefined ? prev?.favorite : undefined,
              archived: flags.archived !== undefined ? prev?.archived : undefined,
            });
          }),
        );
        await get().refresh();
      });
      if (flags.archived !== undefined) {
        ui.showSnackbar(
          flags.archived
            ? ids.length === 1
              ? "Note archived"
              : `${ids.length} notes archived`
            : "Notes restored to your list",
          { actionLabel: "Undo", undoId },
        );
      }
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  trashNotes: async (ids) => {
    const ui = useUiStore.getState();
    if (!ids.length) return;
    try {
      const count = await api.trashNotes(ids);
      set({ notes: get().notes.filter((n) => !ids.includes(n.id)) });
      await get().refresh();
      const undoId = ui.registerUndo("Move to Trash", async () => {
        const restored = await api.restoreNotes(ids);
        await get().refresh();
        if (restored === 0) {
          useUiStore.getState().showSnackbar("Nothing to undo — already deleted.");
        } else {
          ui.showSnackbar("Undid: Move to Trash");
        }
      });
      ui.showSnackbar(count === 1 ? "Note moved to Trash" : noteCountLabel(count), {
        actionLabel: "Undo",
        undoId,
      });
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  trashSelection: async () => {
    const ui = useUiStore.getState();
    const ids = [...ui.selection];
    ui.clearSelection();
    await get().trashNotes(ids);
  },

  restoreNotes: async (ids) => {
    const ui = useUiStore.getState();
    if (!ids.length) return;
    try {
      const count = await api.restoreNotes(ids);
      if (count === 0) {
        // Nothing was restored (e.g. permanently deleted in the meantime);
        // don't claim success or offer an Undo that can't do anything.
        ui.showSnackbar("Nothing to restore — already deleted.");
        return;
      }
      set({ notes: get().notes.filter((n) => !ids.includes(n.id)) });
      await get().refresh();
      const undoId = ui.registerUndo("Restore note", async () => {
        const reTrashed = await api.trashNotes(ids);
        await get().refresh();
        if (reTrashed === 0) {
          useUiStore.getState().showSnackbar("Nothing to undo — already deleted.");
        } else {
          ui.showSnackbar("Undid: Restore note");
        }
      });
      ui.showSnackbar(
        count === 1 ? "Note restored" : `${count} notes restored`,
        { actionLabel: "Undo", undoId },
      );
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  deletePermanent: async (ids) => {
    const ui = useUiStore.getState();
    if (!ids.length) return;
    try {
      await api.deleteNotesPermanent(ids);
      set({ notes: get().notes.filter((n) => !ids.includes(n.id)) });
      await get().refresh();
      ui.showSnackbar("Note permanently deleted");
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  emptyTrash: async () => {
    const ui = useUiStore.getState();
    try {
      await api.emptyTrash();
      set({ notes: [] });
      await get().refresh();
      ui.showSnackbar("Trash emptied");
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  setNoteTags: async (noteId, tagIds) => {
    const ui = useUiStore.getState();
    try {
      const tags = await api.setNoteTags(noteId, tagIds);
      set({
        notes: get().notes.map((n) => (n.id === noteId ? { ...n, tags } : n)),
      });
      await get().refresh();
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  createTag: async (name) => {
    const ui = useUiStore.getState();
    try {
      const tag = await api.createTag(name);
      await get().refresh();
      return tag;
    } catch (e) {
      ui.showSnackbar(errText(e));
      return null;
    }
  },

  deleteTag: async (tagId) => {
    const ui = useUiStore.getState();
    try {
      await api.deleteTag(tagId);
      if (useUiStore.getState().activeTagId === tagId) {
        ui.setActiveTag(null);
      }
      await get().refresh();
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  renameTag: async (tagId, name) => {
    const ui = useUiStore.getState();
    try {
      await api.renameTag(tagId, name);
      await get().refresh();
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },
}));

