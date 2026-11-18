import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import type { Counts, FlagPatch, Note } from "../types";
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
    page: "notes",
    editorNoteId: null,
    editorNote: null,
    pendingReminderAck: null,
    editorFlush: null,
  });
  useUiStore.getState().undoStack.clear();
});

describe("notesStore.createNote (the Ctrl+N data-loss regression)", () => {
  it("flushes pending editor edits before creating and opening a new note", async () => {
    const order: string[] = [];
    useUiStore.getState().registerEditorFlush(() => {
      order.push("flush");
      return Promise.resolve(true);
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
    // Two flushes since 1.5.3: createNote's pre-check (which avoids creating
    // an orphan empty row when the current draft cannot be persisted), then
    // openEditor's own flush before changing subjects. In the app the second
    // is a no-op — the save gate is clean by then.
    expect(order).toEqual(["flush", "flush"]);
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

  it("does not let a refresh from before autosave overwrite the saved note", async () => {
    const old = makeNote("n1", { title: "old" });
    const saved = makeNote("n1", { title: "saved", updatedAt: 3 });
    useNotesStore.setState({ notes: [old] });
    let resolveStale!: (notes: Note[]) => void;
    let listCalls = 0;
    route({
      list_notes: () => {
        listCalls += 1;
        return listCalls === 1
          ? new Promise<Note[]>((resolve) => { resolveStale = resolve; })
          : [saved];
      },
      list_tags: () => [],
      get_counts: () => ({ ...ZERO_COUNTS, all: 1 }),
      update_note: () => saved,
    });

    const staleRefresh = useNotesStore.getState().refresh();
    await useNotesStore.getState().updateNote("n1", { title: "saved" });
    resolveStale([old]);
    await staleRefresh;

    expect(useNotesStore.getState().notes[0].title).toBe("saved");
    expect(listCalls).toBe(2);
  });

  it("keeps a newer reminder and tags when an older autosave reply arrives", async () => {
    const tag = { id: "new-tag", name: "New" };
    useNotesStore.setState({ notes: [makeNote("n1", { reminderAt: 1000, tags: [tag] })] });
    route({ update_note: () => makeNote("n1", { title: "saved", updatedAt: 3 }) });

    await useNotesStore.getState().updateNote("n1", { title: "saved" });

    const note = useNotesStore.getState().notes[0];
    expect(note.title).toBe("saved");
    expect(note.reminderAt).toBe(1000);
    expect(note.tags).toEqual([tag]);
  });
});

describe("notesStore.trash / undo", () => {
  it("moves to trash, then Ctrl+Z restores through restore_notes", async () => {
    route({
      trash_notes: () => ["n1"],
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

  it("keeps the selection when moving notes to Trash fails", async () => {
    route({ trash_notes: () => { throw new Error("Storage unavailable"); } });
    useNotesStore.setState({ notes: [makeNote("n1")] });
    useUiStore.setState({ selection: ["n1"] });

    await useNotesStore.getState().trashSelection();

    expect(useUiStore.getState().selection).toEqual(["n1"]);
    expect(useUiStore.getState().undoStack.size).toBe(0);
  });

  it("undoes only notes newly moved by a mixed stale Trash request", async () => {
    route({
      trash_notes: () => ["active"],
      restore_notes: () => 1,
      list_notes: () => [],
      list_tags: () => [],
      get_counts: () => ({ ...ZERO_COUNTS, trash: 2 }),
    });
    useNotesStore.setState({ notes: [makeNote("active")] });

    await useNotesStore.getState().trashNotes(["active", "already-trashed"]);
    await useUiStore.getState().undo();

    expect(mockedInvoke).toHaveBeenCalledWith("restore_notes", { ids: ["active"] });
  });

  it("does not claim a permanent deletion when the note was restored", async () => {
    route({
      delete_notes_permanent: () => 0,
      list_notes: () => [makeNote("n1")],
      list_tags: () => [],
      get_counts: () => ({ ...ZERO_COUNTS, all: 1 }),
    });
    expect(await useNotesStore.getState().deletePermanent(["n1"])).toBe(false);
    expect(useUiStore.getState().snackbar?.message).toMatch(/Nothing deleted/);
  });
});

describe("notesStore.toggleFlag (rapid pin/favorite shortcuts)", () => {
  it.each(["pinned", "favorite"] as const)(
    "toggles %s after a bulk change and reopen while the list refresh is pending",
    async (key) => {
      let row = makeNote("n1");
      const ui = useUiStore.getState();
      const notes = useNotesStore.getState();
      useNotesStore.setState({ notes: [row] });
      useUiStore.setState({ editorNoteId: row.id, editorNote: row });
      let finishBulkRefresh: (() => void) | undefined;
      let deferList = false;
      route({
        set_flags: (args) => (row = { ...row, ...(args?.flags as FlagPatch) }),
        set_flags_bulk: (args) => {
          row = { ...row, ...(args?.flags as FlagPatch) };
          deferList = true;
          return 1;
        },
        list_notes: () => {
          if (!deferList) return [row];
          deferList = false;
          const bulkRow = row;
          return new Promise<Note[]>((resolve) => {
            finishBulkRefresh = () => resolve([bulkRow]);
          });
        },
        list_tags: () => [],
        get_counts: () => ZERO_COUNTS,
      });

      await notes.toggleFlag(row.id, key);
      expect(row[key]).toBe(true);
      ui.closeEditor();
      useUiStore.setState({ selection: [row.id] });
      const bulk = notes.setFlagsForSelection({ [key]: false });
      await vi.waitFor(() => expect(finishBulkRefresh).toBeDefined());
      expect(row[key]).toBe(false);
      await ui.openEditor(row.id);
      ui.setEditorNote(useNotesStore.getState().notes[0]);

      await notes.toggleFlag(row.id, key);
      finishBulkRefresh?.();
      await bulk;

      expect(row[key]).toBe(true);
      expect(useUiStore.getState().editorNote?.[key]).toBe(true);
    },
  );

  it.each(["pinned", "favorite"] as const)(
    "retries the same %s target when the first of two queued writes fails",
    async (key) => {
      let row = makeNote("n1");
      useNotesStore.setState({ notes: [row] });
      useUiStore.setState({ editorNoteId: row.id, editorNote: row });
      const writes: boolean[] = [];
      route({
        set_flags: (args) => {
          const target = (args?.flags as Pick<Note, typeof key>)[key];
          writes.push(target);
          if (writes.length === 1) throw new Error("Storage unavailable");
          return (row = { ...row, [key]: target });
        },
        list_notes: () => [row],
        list_tags: () => [],
        get_counts: () => ZERO_COUNTS,
      });

      const { toggleFlag } = useNotesStore.getState();
      const [first, second] = await Promise.all([
        toggleFlag(row.id, key),
        toggleFlag(row.id, key),
      ]);

      expect(first).toBeNull();
      expect(second?.[key]).toBe(true);
      expect(writes).toEqual([true, true]);
      expect(useUiStore.getState().editorNote?.[key]).toBe(true);
    },
  );

  it("keeps the toolbar's committed flags when an older autosave reply lands", async () => {
    let row = makeNote("n1");
    useNotesStore.setState({ notes: [row] });
    useUiStore.setState({ editorNoteId: row.id, editorNote: row });
    let replyToSave!: () => void;
    route({
      update_note: () => {
        row = { ...row, title: "New title", updatedAt: 3 };
        const saved = row;
        return new Promise<Note>((resolve) => { replyToSave = () => resolve(saved); });
      },
      set_flags: (args) => (row = { ...row, ...(args?.flags as FlagPatch) }),
      list_notes: () => [row],
      list_tags: () => [],
      get_counts: () => ZERO_COUNTS,
    });

    const notes = useNotesStore.getState();
    const saving = notes.updateNote(row.id, { title: "New title" });
    await notes.toggleFlag(row.id, "pinned");
    await notes.toggleFlag(row.id, "favorite");
    replyToSave();
    await saving;

    expect(useUiStore.getState().editorNote).toMatchObject({
      title: "New title",
      pinned: true,
      favorite: true,
    });
    expect(useNotesStore.getState().notes[0]).toEqual(row);
    await notes.toggleFlag(row.id, "pinned");
    expect(row.pinned).toBe(false);
  });

  it("two rapid pin presses write true then false and restore UI + DB state", async () => {
    const base = makeNote("pin-note");
    useNotesStore.setState({ notes: [base] });
    useUiStore.setState({ editorNoteId: "pin-note", editorNote: base });
    const writes: boolean[] = [];
    route({
      set_flags: (args) => {
        const pinned = (args?.flags as { pinned?: boolean }).pinned === true;
        writes.push(pinned);
        return makeNote("pin-note", { pinned });
      },
      list_notes: () => useNotesStore.getState().notes,
      list_tags: () => [],
      get_counts: () => ({ ...ZERO_COUNTS, all: 1 }),
    });

    // Both presses are issued before either IPC reply lands.
    await Promise.all([
      useNotesStore.getState().toggleFlag("pin-note", "pinned"),
      useNotesStore.getState().toggleFlag("pin-note", "pinned"),
    ]);

    expect(writes).toEqual([true, false]);
    expect(useNotesStore.getState().notes[0].pinned).toBe(false);
    expect(useUiStore.getState().editorNote?.pinned).toBe(false);
  });

  it("does the same for favorite, from the committed snapshot", async () => {
    const base = makeNote("fav-note", { favorite: true });
    useNotesStore.setState({ notes: [base] });
    useUiStore.setState({ editorNoteId: "fav-note", editorNote: base });
    const writes: boolean[] = [];
    route({
      set_flags: (args) => {
        const favorite = (args?.flags as { favorite?: boolean }).favorite === true;
        writes.push(favorite);
        return makeNote("fav-note", { favorite });
      },
      list_notes: () => useNotesStore.getState().notes,
      list_tags: () => [],
      get_counts: () => ({ ...ZERO_COUNTS, all: 1 }),
    });

    await Promise.all([
      useNotesStore.getState().toggleFlag("fav-note", "favorite"),
      useNotesStore.getState().toggleFlag("fav-note", "favorite"),
    ]);

    expect(writes).toEqual([false, true]);
    expect(useNotesStore.getState().notes[0].favorite).toBe(true);
    expect(useUiStore.getState().editorNote?.favorite).toBe(true);
  });
});

describe("notesStore.setTagForSelection", () => {
  it("applies one tag across the selection atomically, with a full-list Undo", async () => {
    const t = { id: "tag1", name: "Work" };
    useNotesStore.setState({ notes: [makeNote("a"), makeNote("b")], tags: [t] });
    useUiStore.setState({ selection: ["a", "b"] });
    const restoredTagSets: Array<{ noteId: string; tagIds: string[] }>[] = [];
    route({
      set_tags_bulk: (args) => (args?.apply ? 2 : 0),
      restore_tags_bulk: (args) => {
        restoredTagSets.push(args!.entries as Array<{ noteId: string; tagIds: string[] }>);
        return 2;
      },
      list_notes: () => [makeNote("a"), makeNote("b")],
      list_tags: () => [t],
      get_counts: () => ({ ...ZERO_COUNTS, all: 2 }),
    });

    await useNotesStore.getState().setTagForSelection("tag1", true);
    expect(mockedInvoke).toHaveBeenCalledWith("set_tags_bulk", {
      ids: ["a", "b"],
      tagId: "tag1",
      apply: true,
    });
    expect(useUiStore.getState().selection).toEqual([]); // cleared once done

    // Undo restores each note's previous (tagless) list exactly.
    await useUiStore.getState().undo();
    expect(restoredTagSets).toEqual([[{ noteId: "a", tagIds: [] }, { noteId: "b", tagIds: [] }]]);
  });

  it("does not clear a selection the user changed mid-flight", async () => {
    const t = { id: "tag1", name: "Work" };
    useNotesStore.setState({ notes: [makeNote("a")], tags: [t] });
    useUiStore.setState({ selection: ["a"] });
    mockedInvoke.mockImplementation((async (cmd: string) => {
      switch (cmd) {
        case "set_tags_bulk":
          // user re-selects while this request is in flight
          useUiStore.setState({ selection: ["a", "b"] });
          return 1;
        case "list_notes":
          return [makeNote("a"), makeNote("b")];
        case "list_tags":
          return [t];
        case "get_counts":
          return { ...ZERO_COUNTS, all: 2 };
        default:
          throw new Error(`unexpected command: ${cmd}`);
      }
    }) as unknown as typeof invoke);

    await useNotesStore.getState().setTagForSelection("tag1", true);
    expect(useUiStore.getState().selection).toEqual(["a", "b"]); // survived
  });

  it("undoes to the tags from before a concurrent refresh", async () => {
    const work = { id: "work", name: "Work" };
    const later = { id: "later", name: "Later" };
    useNotesStore.setState({ notes: [makeNote("a", { tags: [work] })], tags: [work, later] });
    useUiStore.setState({ selection: ["a"] });
    let resolveWrite!: (count: number) => void;
    const restored: Array<{ noteId: string; tagIds: string[] }>[] = [];
    route({
      set_tags_bulk: () => new Promise<number>((resolve) => { resolveWrite = resolve; }),
      restore_tags_bulk: (args) => {
        restored.push(args!.entries as Array<{ noteId: string; tagIds: string[] }>);
        return 1;
      },
      list_notes: () => [makeNote("a", { tags: [work, later] })],
      list_tags: () => [work, later],
      get_counts: () => ({ ...ZERO_COUNTS, all: 1 }),
    });

    const pending = useNotesStore.getState().setTagForSelection("later", true);
    useNotesStore.setState({ notes: [makeNote("a", { tags: [work, later] })] });
    resolveWrite(1);
    await pending;
    await useUiStore.getState().undo();

    expect(restored).toEqual([[{ noteId: "a", tagIds: ["work"] }]]);
  });
});
