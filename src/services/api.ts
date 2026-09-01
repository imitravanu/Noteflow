import { invoke } from "@tauri-apps/api/core";
import type {
  Counts,
  FlagPatch,
  Note,
  NotePatch,
  NoteView,
  Tag,
} from "../types";

const cmd = invoke;

export const api = {
  listNotes(view: NoteView, tagId: string | null, query: string) {
    return cmd<Note[]>("list_notes", {
      view,
      tagId: tagId ?? null,
      query: query.trim() ? query : null,
    });
  },

  createNote(color?: string) {
    return cmd<Note>("create_note", { color: color ?? null });
  },

  getNote(id: string) {
    return cmd<Note>("get_note", { id });
  },

  updateNote(id: string, patch: NotePatch) {
    return cmd<Note>("update_note", { id, patch });
  },

  setFlags(id: string, flags: FlagPatch) {
    return cmd<Note>("set_flags", { id, flags });
  },

  trashNotes(ids: string[]) {
    return cmd<number>("trash_notes", { ids });
  },

  restoreNotes(ids: string[]) {
    return cmd<number>("restore_notes", { ids });
  },

  deleteNotesPermanent(ids: string[]) {
    return cmd<number>("delete_notes_permanent", { ids });
  },

  emptyTrash() {
    return cmd<number>("empty_trash");
  },

  setNoteTags(noteId: string, tagIds: string[]) {
    return cmd<Tag[]>("set_note_tags", { noteId, tagIds });
  },

  getCounts() {
    return cmd<Counts>("get_counts");
  },

  listTags() {
    return cmd<Tag[]>("list_tags");
  },

  createTag(name: string) {
    return cmd<Tag>("create_tag", { name });
  },

  renameTag(id: string, name: string) {
    return cmd<Tag>("rename_tag", { id, name });
  },

  deleteTag(id: string) {
    return cmd<boolean>("delete_tag", { id });
  },

  getSetting(key: string) {
    return cmd<string | null>("get_setting", { key });
  },

  setSetting(key: string, value: string) {
    return cmd<void>("set_setting", { key, value });
  },

  getDataDir() {
    return cmd<string>("get_data_dir");
  },
};

