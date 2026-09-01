export type NoteColor =
  | "default"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "purple";

export const NOTE_COLORS: NoteColor[] = [
  "default",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
];

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface Tag {
  id: string;
  name: string;
  noteCount?: number | null;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  deleted: boolean;
  deletedAt: number | null;
  reminderAt: number | null;
  checklist: ChecklistItem[];
  tags: Tag[];
}

export type NoteView = "all" | "pinned" | "favorites" | "archive" | "trash";

export interface NotePatch {
  title?: string;
  content?: string;
  color?: string;
  checklist?: ChecklistItem[];
}

export interface FlagPatch {
  pinned?: boolean;
  favorite?: boolean;
  archived?: boolean;
}

export interface Counts {
  all: number;
  pinned: number;
  favorites: number;
  archived: number;
  trash: number;
}

export type Theme = "light" | "dark" | "system";

export type SaveStatus = "saved" | "saving" | "offline";

