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
  notes: unknown[];
  /** Top-level tag list (v1.3.1+); older backups omit it. */
  tags?: unknown[];
}

/** Parses Settings backup JSON. Accepts `{notes:[...]}` or raw `[...]`. Throws on invalid shape. */
export function parseBackupJson(text: string): ParsedBackup {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return { notes: parsed };
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { notes?: unknown }).notes)) {
    throw new Error("Not a NoteFlow backup file.");
  }
  const backup = parsed as { notes: unknown[]; tags?: unknown };
  return {
    notes: backup.notes,
    // Preserve a malformed top-level tag value as one invalid entry so the
    // importer reports it instead of silently dropping that part of a file.
    tags: backup.tags === undefined
      ? undefined
      : Array.isArray(backup.tags) ? backup.tags : [backup.tags],
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
