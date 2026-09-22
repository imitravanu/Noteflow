import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import type { Counts, Note } from "../types";
import { useNotesStore } from "./notesStore";
import { useUiStore } from "./uiStore";

const mockedInvoke = vi.mocked(invoke);

const ZERO_COUNTS: Counts = { all: 0, pinned: 0, favorites: 0, archived: 0, trash: 0 };

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `title-${id}`,
    content: `content-${id}`,
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
    ...overrides,
  };
}

/** Routes each command to a canned handler; anything unhandled fails loudly. */
function route(handlers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  mockedInvoke.mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unexpected command: ${cmd}`);
    return handler(args);
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  mockedInvoke.mockReset();
  useNotesStore.setState({
    notes: [],
    tags: [],
    counts: { ...ZERO_COUNTS },
    loading: false,
  });
  useUiStore.setState({
    view: "all",
    activeTagId: null,
    query: "",
    selection: [],
    anchorId: null,
    snackbar: null,
    openPopover: null,
    editorNoteId: null,
    editorFlush: null,
  });
  useUiStore.getState().undoStack.clear();
});

describe("notesStore.createNote (the Ctrl+N data-loss regression)", () => {
  it("flushes pending editor edits before creating and opening a new note", async () => {
    const order: string[] = [];
    useUiStore.getState().registerEditorFlush(() => {
      order.push("flush");
      return Promise.resolve();
    });
    route({
      create_note: () => makeNote("n1"),
      list_notes: () => [makeNote("n1")],
      list_tags: () => [],
      get_counts: () => ({ ...ZERO_COUNTS, all: 1 }),
    });

    await useNotesStore.getState().createNote();

    // Flush must land BEFORE the editor switches notes — switching resets the
    // save gate, which drops any buffer still inside its debounce window.
    expect(order).toEqual(["flush"]);
    expect(useUiStore.getState().editorNoteId).toBe("n1");
  });
});

describe("notesStore.refresh (stale-response protection)", () => {
  it("discards a slow, superseded list response that resolves last", async () => {
    const n1 = makeNote("n1");
    const n2 = makeNote("n2");
    let resolveSlow!: (notes: Note[]) => void;
    let listCalls = 0;
    mockedInvoke.mockImplementation((async (cmd: string) => {
      switch (cmd) {
        case "list_notes":
          listCalls += 1;
          if (listCalls === 1) {
            return new Promise<Note[]>((resolve) => {
              resolveSlow = resolve;
            });
          }
          return [n2];
        case "list_tags":
          return [];
        case "get_counts":
          return { ...ZERO_COUNTS, all: 1 };
        default:
          throw new Error(`unexpected command: ${cmd}`);
      }
    }) as unknown as typeof invoke);

    const stale = useNotesStore.getState().refresh();
    const fresh = useNotesStore.getState().refresh();
    await fresh;
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(["n2"]);

    resolveSlow([n1]); // the older request finally lands — must be ignored
    await stale;
    expect(useNotesStore.getState().notes.map((n) => n.id)).toEqual(["n2"]);
    expect(useNotesStore.getState().loading).toBe(false);
  });
});

describe("notesStore.trash / undo", () => {
  it("moves to trash, then Ctrl+Z restores through restore_notes", async () => {
    route({
      trash_notes: () => 1,
      restore_notes: () => 1,
      list_notes: () => [],
      list_tags: () => [],
      get_counts: () => ({ ...ZERO_COUNTS }),
    });
    useNotesStore.setState({ notes: [makeNote("n1")] });

    await useNotesStore.getState().trashNotes(["n1"]);
    expect(useNotesStore.getState().notes).toEqual([]);
    expect(useUiStore.getState().snackbar?.actionLabel).toBe("Undo");
    expect(useUiStore.getState().snackbar?.message).toBe("Note moved to Trash");

    await useUiStore.getState().undo();
    expect(mockedInvoke).toHaveBeenCalledWith("restore_notes", { ids: ["n1"] });
    expect(useUiStore.getState().snackbar?.message).toBe("Undid: Move to Trash");
  });

  it("does not register an undo when restore reports nothing to restore", async () => {
    route({ restore_notes: () => 0 });
    await useNotesStore.getState().restoreNotes(["ghost"]);
    expect(mockedInvoke).toHaveBeenCalledWith("restore_notes", { ids: ["ghost"] });
    expect(useUiStore.getState().snackbar?.message).toMatch(/Nothing to restore/);
    expect(useUiStore.getState().undoStack.size).toBe(0);
  });
});
