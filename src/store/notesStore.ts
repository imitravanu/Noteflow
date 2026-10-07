import { create } from "zustand";
import type { Counts, FlagPatch, Note, NotePatch, Tag } from "../types";
import { api } from "../services/api";
import { errText, useUiStore } from "./uiStore";

/** Monotonic token so stale async list results never overwrite fresh ones. */
let requestSeq = 0;
let activeRefreshes = 0;

interface NotesState {
  notes: Note[];
  tags: Tag[];
  counts: Counts;
  loading: boolean;

  refresh: () => Promise<void>;
  createNote: () => Promise<void>;
  updateNote: (id: string, patch: NotePatch) => Promise<Note | null>;
  setReminder: (id: string, reminderAt: number | null) => Promise<Note | null>;
  setFlags: (id: string, flags: FlagPatch) => Promise<Note | null>;
  setFlagsForSelection: (flags: FlagPatch) => Promise<void>;
  trashNotes: (ids: string[]) => Promise<boolean>;
  trashSelection: () => Promise<void>;
  restoreNotes: (ids: string[]) => Promise<void>;
  deletePermanent: (ids: string[]) => Promise<boolean>;
  emptyTrash: () => Promise<void>;
  /** Sets a note's tags; resolves with the server's resulting tag list
   *  (null on failure) so callers (the editor) can merge without a second IPC. */
  setNoteTags: (noteId: string, tagIds: string[]) => Promise<Tag[] | null>;
  /** Apply/remove one tag across the whole selection (undoable, atomic). */
  setTagForSelection: (tagId: string, apply: boolean) => Promise<void>;
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
    activeRefreshes += 1;
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
    } finally {
      activeRefreshes -= 1;
    }
  },

  createNote: async () => {
    const ui = useUiStore.getState();
    try {
      // Avoid creating an orphan empty row when an existing editor cannot
      // persist its draft. openEditor checks again before changing subjects.
      if (!(await ui.flushEditor())) return;
      const note = await api.createNote();
      await get().refresh();
      // openEditor flushes the open editor (if any) before switching, so
      // Ctrl+N while typing no longer drops edits to the gate reset.
      await ui.openEditor(note.id);
    } catch (e) {
      ui.showSnackbar(errText(e));
    }
  },

  updateNote: async (id, patch) => {
    try {
      const updated = await api.updateNote(id, patch);
      // A list request may have read the old row before this write, then be
      // delayed by its tags/counts requests. Invalidate that response.
      const hadPendingRefresh = activeRefreshes > 0;
      requestSeq += 1;
      const sorted = get()
        .notes.map((n) =>
          n.id === id
            ? {
                ...n,
                title: updated.title,
                content: updated.content,
                color: updated.color,
                checklist: updated.checklist,
                updatedAt: updated.updatedAt,
              }
            : n,
        )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
      set({ notes: sorted });
      // Re-evaluate search membership after text changes, or replace any
      // invalidated list request with one that observes the committed write.
      if (hadPendingRefresh || useUiStore.getState().query.trim()) void get().refresh();
      return updated;
    } catch (e) {
      useUiStore.getState().showSnackbar(errText(e));
      return null;
    }
  },

  /**
   * Scheduling a reminder changes no flag, no sort key and no view membership,
   * so it patches the note in place instead of paying for a full refresh.
   */
  setReminder: async (id, reminderAt) => {
    try {
      const updated = await api.setReminder(id, reminderAt);
      const hadPendingRefresh = activeRefreshes > 0;
      requestSeq += 1;
      set({
        notes: get().notes.map((n) =>
          n.id === id ? { ...n, reminderAt: updated.reminderAt } : n,
        ),
      });
      if (hadPendingRefresh) void get().refresh();
      return updated;
    } catch (e) {
      useUiStore.getState().showSnackbar(errText(e));
      return null;
    }
  },

  /** Updates flags and returns the updated note (or null on failure). */
  setFlags: async (id, flags) => {
    const ui = useUiStore.getState();
    const before = get().notes.find((n) => n.id === id);
    try {
      const updated = await api.setFlags(id, flags);
      set({
        notes: get().notes.map((n) =>
          n.id === id
            ? {
                ...n,
                pinned: updated.pinned,
                favorite: updated.favorite,
                archived: updated.archived,
              }
            : n,
        ),
      });
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
      await api.setFlagsBulk(ids, flags);
      // Scoped: only drop the selection if the user hasn't re-selected while
      // the request was in flight.
      useUiStore.getState().clearSelectionIfUnchanged(ids);
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
        await api.restoreFlagsBulk(
          ids.flatMap((id) => {
            const prev = before.get(id);
            return prev
              ? [{
                  id,
                  pinned: flags.pinned !== undefined ? prev.pinned : undefined,
                  favorite: flags.favorite !== undefined ? prev.favorite : undefined,
                  archived: flags.archived !== undefined ? prev.archived : undefined,
                }]
              : [];
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
    if (!ids.length) return false;
    try {
      const changedIds = await api.trashNotes(ids);
      const count = changedIds.length;
      if (count === 0) {
        await get().refresh();
        ui.showSnackbar("Nothing to move — those notes are no longer active.");
        return false;
      }
      set({ notes: get().notes.filter((n) => !changedIds.includes(n.id)) });
      await get().refresh();
      const undoId = ui.registerUndo("Move to Trash", async () => {
        const restored = await api.restoreNotes(changedIds);
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
      return true;
    } catch (e) {
      ui.showSnackbar(errText(e));
      return false;
    }
  },

  trashSelection: async () => {
    const ui = useUiStore.getState();
    const ids = [...ui.selection];
    if (await get().trashNotes(ids)) {
      useUiStore.getState().clearSelectionIfUnchanged(ids);
    }
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
        if (reTrashed.length === 0) {
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
    if (!ids.length) return false;
    try {
      const count = await api.deleteNotesPermanent(ids);
      if (count === 0) {
        await get().refresh();
        ui.showSnackbar("Nothing deleted — those notes may have been restored.");
        return false;
      }
      set({ notes: get().notes.filter((n) => !ids.includes(n.id)) });
      await get().refresh();
      ui.showSnackbar(
        count === 1 ? "Note permanently deleted" : `${count} notes permanently deleted`,
      );
      return true;
    } catch (e) {
      ui.showSnackbar(errText(e));
      return false;
    }
  },

  emptyTrash: async () => {
    const ui = useUiStore.getState();
    try {
      await api.emptyTrash();
      // Only clear optimistically when we're looking at trash;
      // otherwise we'd flash an empty All/Archive list before refresh.
      if (useUiStore.getState().view === "trash") {
        set({ notes: [] });
      }
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
      return tags;
    } catch (e) {
      ui.showSnackbar(errText(e));
      return null;
    }
  },

  setTagForSelection: async (tagId, apply) => {
    const ui = useUiStore.getState();
    const ids = [...ui.selection];
    if (!ids.length) return;
    // Undo needs the state before the IPC write. A concurrent refresh can
    // update `notes` while the request is in flight.
    const before = new Map(
      get()
        .notes.filter((n) => ids.includes(n.id))
        .map((n) => [n.id, n.tags] as const),
    );
    try {
      await api.setTagsBulk(ids, tagId, apply);
      // Scoped: only drop the selection if the user hasn't re-selected while
      // the request was in flight.
      useUiStore.getState().clearSelectionIfUnchanged(ids);
      await get().refresh();
      const undoId = ui.registerUndo(apply ? "Tag notes" : "Untag notes", async () => {
        await api.restoreTagsBulk(
          [...before.entries()].map(([noteId, tags]) => ({
            noteId,
            tagIds: tags.map((tag) => tag.id),
          })),
        );
        await get().refresh();
      });
      ui.showSnackbar(apply ? "Tag applied" : "Tag removed", {
        actionLabel: "Undo",
        undoId,
      });
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
