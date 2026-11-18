import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  toggleFavoriteShortcut,
  togglePinShortcut,
} from "./useKeyboardShortcuts";
import type { Note } from "../types";
import type { useNotesStore } from "../store/notesStore";
import type { useUiStore } from "../store/uiStore";

type Ui = ReturnType<typeof useUiStore.getState>;
type Notes = ReturnType<typeof useNotesStore.getState>;

function note(id: string, flags: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    content: "",
    color: "default",
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    favorite: false,
    archived: false,
    deleted: false,
    deletedAt: null,
    reminderAt: null,
    checklist: [],
    tags: [],
    ...flags,
  };
}

function notesState(list: Note[], overrides: Partial<Notes> = {}): Notes {
  return {
    notes: list,
    toggleFlag: vi.fn(),
    setFlagsForSelection: vi.fn(),
    ...overrides,
  } as unknown as Notes;
}

describe("pin/favorite shortcut scope", () => {
  it("routes the editor shortcut through the same serialized toggle action as the toolbar", () => {
    const notes = notesState([note("n1")]);
    const ui = {
      editorNoteId: "n1",
      editorNote: note("n1"),
      selection: [],
    } as unknown as Ui;

    togglePinShortcut(ui, notes);

    expect(notes.toggleFlag).toHaveBeenCalledWith("n1", "pinned");
    expect(notes.setFlagsForSelection).not.toHaveBeenCalled();
  });

  it("preserves batch toggling when no editor is open", () => {
    const notes = notesState([
      note("a", { pinned: true }),
      note("b", { pinned: true }),
    ]);
    const ui = {
      editorNoteId: null,
      editorNote: null,
      selection: ["a", "b"],
    } as unknown as Ui;

    togglePinShortcut(ui, notes);
    expect(notes.setFlagsForSelection).toHaveBeenCalledWith({ pinned: false });

    toggleFavoriteShortcut(ui, notes);
    expect(notes.setFlagsForSelection).toHaveBeenLastCalledWith({ favorite: true });
    expect(notes.toggleFlag).not.toHaveBeenCalled();
  });
});
