import type { Note, Tag } from "../types";

export interface BackupFile {
  version?: string;
  exportedAt?: string;
  notesCount?: number;
  tagsCount?: number;
  notes: Note[];
  tags?: Tag[];
}

/** Parses Settings backup JSON. Accepts `{notes:[...]}` or raw `[...]`. Throws on invalid shape. */
export function parseBackupJson(text: string): Note[] {
  const parsed = JSON.parse(text) as BackupFile | Note[];
  const notes = Array.isArray(parsed) ? parsed : parsed.notes;
  if (!Array.isArray(notes)) {
    throw new Error("Not a NoteFlow backup file.");
  }
  return notes as Note[];
}

/** Builds the portable backup payload written by Settings > Export. */
export function buildBackupPayload(notes: Note[], tags: Tag[], version: string): BackupFile {
  return {
    version,
    exportedAt: new Date().toISOString(),
    notesCount: notes.length,
    tagsCount: tags.length,
    notes,
    tags,
  };
}
