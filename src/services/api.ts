import { invoke } from "@tauri-apps/api/core";
import type {
  Counts,
  FlagPatch,
  ImportReport,
  Note,
  NotePatch,
  NoteView,
  Tag,
} from "../types";

export const api = {
  listNotes(view: NoteView, tagId: string | null, query: string) {
    return invoke<Note[]>("list_notes", {
      view,
      tagId: tagId ?? null,
      query: query.trim() ? query : null,
    });
  },

  createNote(color?: string) {
    return invoke<Note>("create_note", { color: color ?? null });
  },

  getNote(id: string) {
    return invoke<Note>("get_note", { id });
  },

  updateNote(id: string, patch: NotePatch) {
    return invoke<Note>("update_note", { id, patch });
  },

  setFlags(id: string, flags: FlagPatch) {
    return invoke<Note>("set_flags", { id, flags });
  },

  setFlagsBulk(ids: string[], flags: FlagPatch) {
    return invoke<number>("set_flags_bulk", { ids, flags });
  },

  exportAllNotes() {
    return invoke<Note[]>("export_all_notes");
  },

  importBackup(notes: Note[], tags?: Tag[]) {
    return invoke<ImportReport>("import_backup", { notes, tags: tags ?? null });
  },

  trashNotes(ids: string[]) {
    return invoke<number>("trash_notes", { ids });
  },

  restoreNotes(ids: string[]) {
    return invoke<number>("restore_notes", { ids });
  },

  deleteNotesPermanent(ids: string[]) {
    return invoke<number>("delete_notes_permanent", { ids });
  },

  emptyTrash() {
    return invoke<number>("empty_trash");
  },

  setNoteTags(noteId: string, tagIds: string[]) {
    return invoke<Tag[]>("set_note_tags", { noteId, tagIds });
  },

  setTagsBulk(ids: string[], tagId: string, apply: boolean) {
    return invoke<number>("set_tags_bulk", { ids, tagId, apply });
  },

  getCounts() {
    return invoke<Counts>("get_counts");
  },

  listTags() {
    return invoke<Tag[]>("list_tags");
  },

  createTag(name: string) {
    return invoke<Tag>("create_tag", { name });
  },

  renameTag(id: string, name: string) {
    return invoke<Tag>("rename_tag", { id, name });
  },

  deleteTag(id: string) {
    return invoke<boolean>("delete_tag", { id });
  },

  getSetting(key: string) {
    return invoke<string | null>("get_setting", { key });
  },

  setSetting(key: string, value: string) {
    return invoke<void>("set_setting", { key, value });
  },

  getDataDir() {
    return invoke<string>("get_data_dir");
  },

  /** Writes text to disk from Rust (download dir, fallback: data dir); returns the path. */
  saveTextFile(filename: string, content: string) {
    return invoke<string>("save_text_file", { filename, content });
  },
};

