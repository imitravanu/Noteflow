import type { Note, Tag } from "../types";

export interface BackupFile {
  version?: string;
  exportedAt?: string;
  notesCount?: number;
  tagsCount?: number;
  notes: Note[];
  tags?: Tag[];
}

export interface ParsedBackup {
  notes: Note[];
  /** Top-level tag list (v1.3.1+); older backups omit it. */
  tags?: Tag[];
}

/** Parses Settings backup JSON. Accepts `{notes:[...]}` or raw `[...]`. Throws on invalid shape. */
export function parseBackupJson(text: string): ParsedBackup {
  const parsed = JSON.parse(text) as BackupFile | Note[];
  if (Array.isArray(parsed)) return { notes: parsed };
  if (!Array.isArray(parsed.notes)) {
    throw new Error("Not a NoteFlow backup file.");
  }
  return {
    notes: parsed.notes,
    tags: Array.isArray(parsed.tags) ? parsed.tags : undefined,
  };
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
