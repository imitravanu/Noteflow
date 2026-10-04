import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { useUiStore } from "./uiStore";

beforeEach(() => {
  useUiStore.setState({
    view: "all",
    activeTagId: null,
    query: "",
    selection: [],
    anchorId: null,
    snackbar: null,
    snackbarQueue: [],
    openPopover: null,
    editorNoteId: null,
    editorReturnFocusId: null,
    editorFlush: null,
  });
  useUiStore.getState().undoStack.clear();
});

describe("uiStore.clearSelectionIfUnchanged", () => {
  it("clears only when the selection is exactly the requested ids", () => {
    useUiStore.getState().selectAll(["a", "b"]);
    useUiStore.getState().clearSelectionIfUnchanged(["b", "a"]); // order differs
    expect(useUiStore.getState().selection).toEqual(["a", "b"]); // untouched

    useUiStore.getState().clearSelectionIfUnchanged(["a", "b"]);
    expect(useUiStore.getState().selection).toEqual([]);
  });

  it("leaves a mid-flight re-selection alone", () => {
    useUiStore.getState().selectAll(["a", "b"]);
    // user re-selects while a bulk action is in flight
    useUiStore.getState().selectAll(["c"]);
    useUiStore.getState().clearSelectionIfUnchanged(["a", "b"]);
    expect(useUiStore.getState().selection).toEqual(["c"]);
  });
});

describe("uiStore snackbar queue", () => {
  it("a plain toast does not overwrite a visible toast WITH a live action", () => {
    useUiStore.getState().showSnackbar("Note moved to Trash", {
      actionLabel: "Undo",
      action: () => {},
    });
    useUiStore.getState().showSnackbar("Reminder: Groceries");

    const s = useUiStore.getState();
    expect(s.snackbar?.message).toBe("Note moved to Trash"); // Undo affordance survived
    expect(s.snackbarQueue.map((q) => q.message)).toEqual(["Reminder: Groceries"]);
  });

  it("a plain toast IS replaced when the current toast has no affordance to lose", () => {
    useUiStore.getState().showSnackbar("Nothing to undo.");
    useUiStore.getState().showSnackbar("Reminder: Groceries");
    expect(useUiStore.getState().snackbar?.message).toBe("Reminder: Groceries");
    expect(useUiStore.getState().snackbarQueue).toEqual([]);
  });

  it("hiding advances the queue in order", () => {
    useUiStore.getState().showSnackbar("Trash", { actionLabel: "Undo", action: () => {} });
    useUiStore.getState().showSnackbar("first");
    useUiStore.getState().showSnackbar("second");
    useUiStore.getState().hideSnackbar();
    expect(useUiStore.getState().snackbar?.message).toBe("first");
    useUiStore.getState().hideSnackbar();
    expect(useUiStore.getState().snackbar?.message).toBe("second");
    useUiStore.getState().hideSnackbar();
    expect(useUiStore.getState().snackbar).toBeNull();
  });

  it("replace:true claims the slot behind an actionable toast (undo outcome feedback)", () => {
    useUiStore.getState().showSnackbar("Something stale", {
      actionLabel: "Undo",
      action: () => {},
    });
    useUiStore.getState().showSnackbar("Undid: Move to Trash", { replace: true });
    expect(useUiStore.getState().snackbar?.message).toBe("Undid: Move to Trash");
  });

  it("the queue is capped, oldest-first", () => {
    useUiStore.getState().showSnackbar("Anchor", { actionLabel: "Undo", action: () => {} });
    for (let i = 1; i <= 6; i++) useUiStore.getState().showSnackbar(`t${i}`);
    const q = useUiStore.getState().snackbarQueue.map((e) => e.message);
    expect(q).toEqual(["t3", "t4", "t5", "t6"]); // t1/t2 dropped, newest kept
  });
});

describe("uiStore.openEditor (the note-switch data-loss regression)", () => {
  it("flushes pending editor edits before switching notes", async () => {
    const order: string[] = [];
    useUiStore.setState({ editorNoteId: "n1" });
    useUiStore.getState().registerEditorFlush(() => {
      order.push("flush");
      return Promise.resolve(true);
    });

    await useUiStore.getState().openEditor("n2");

    // The gate reset on switch drops anything still inside the debounce
    // window, so the flush must land BEFORE the id changes — this is the
    // reminder-"Open" toast path (reached without createNote's flush).
    expect(order).toEqual(["flush"]);
    expect(useUiStore.getState().editorNoteId).toBe("n2");
  });

  it("waits for the flush chain to settle before the id changes", async () => {
    let resolveFlush!: (saved: boolean) => void;
    useUiStore.setState({ editorNoteId: "n1" });
    useUiStore.getState().registerEditorFlush(
      () => new Promise<boolean>((r) => (resolveFlush = r)),
    );

    const opening = useUiStore.getState().openEditor("n2");
    expect(useUiStore.getState().editorNoteId).toBe("n1"); // not switched yet
    resolveFlush(true);
    await opening;
    expect(useUiStore.getState().editorNoteId).toBe("n2");
  });

  it("records the return-focus card only when opening from a closed editor", async () => {
    await useUiStore.getState().openEditor("n1", "n1");
    expect(useUiStore.getState().editorReturnFocusId).toBe("n1");

    // Switching inside the open editor keeps the original target.
    await useUiStore.getState().openEditor("n2", "n2");
    expect(useUiStore.getState().editorReturnFocusId).toBe("n1");
  });
});

describe("uiStore selection", () => {
  it("toggles single select then ctrl-adds", () => {
    const ui = useUiStore.getState();
    ui.toggleSelect("a", { ctrl: false, shift: false }, ["a", "b"]);
    expect(useUiStore.getState().selection).toEqual(["a"]);

    useUiStore.getState().toggleSelect("b", { ctrl: true, shift: false }, ["a", "b"]);
    expect(useUiStore.getState().selection).toEqual(["a", "b"]);
  });

  it("shift range unions with existing selection", () => {
    const ui = useUiStore.getState();
    ui.toggleSelect("a", { ctrl: false, shift: false }, ["a", "b", "c", "d"]);
    useUiStore.getState().toggleSelect("c", { ctrl: false, shift: true }, ["a", "b", "c", "d"]);
    expect(useUiStore.getState().selection.sort()).toEqual(["a", "b", "c"]);
  });

  it("setView clears selection and tag", () => {
    useUiStore.setState({ selection: ["a"], activeTagId: "t" });
    useUiStore.getState().setView("trash");
    expect(useUiStore.getState().selection).toEqual([]);
    expect(useUiStore.getState().activeTagId).toBeNull();
  });
});

describe("uiStore undo snackbar", () => {
  it("undoById runs and removes the entry", async () => {
    const ui = useUiStore.getState();
    let ran = false;
    const id = ui.registerUndo("test", () => void (ran = true));
    ui.showSnackbar("done", { actionLabel: "Undo", undoId: id });
    expect(useUiStore.getState().snackbar?.action).toBeTypeOf("function");
    await useUiStore.getState().undoById(id);
    expect(ran).toBe(true);
    expect(useUiStore.getState().undoStack.size).toBe(0);
  });

  it("undoById on an unknown/evicted id explains it can't be undone", async () => {
    useUiStore.getState().showSnackbar("something");
    await useUiStore.getState().undoById(999);
    expect(useUiStore.getState().snackbar?.message).toMatch(
      /can no longer be undone/,
    );
  });

  it("Ctrl+Z with an empty stack says there is nothing to undo", async () => {
    await useUiStore.getState().undo();
    expect(useUiStore.getState().snackbar?.message).toBe("Nothing to undo.");
  });
});

describe("uiStore popover registration (Escape cascade)", () => {
  it("tracks the registered popover and invokes its close callback", () => {
    let closed = false;
    useUiStore.getState().registerPopover("color", () => (closed = true));
    expect(useUiStore.getState().openPopover?.id).toBe("color");

    useUiStore.getState().openPopover?.close();
    expect(closed).toBe(true);
  });

  it("a stale unmount does not clear a popover registered after it", () => {
    useUiStore.getState().registerPopover("first", () => {});
    useUiStore.getState().registerPopover("second", () => {});

    // "first" unmounts late — must not hide "second".
    useUiStore.getState().unregisterPopover("first");
    expect(useUiStore.getState().openPopover?.id).toBe("second");

    useUiStore.getState().unregisterPopover("second");
    expect(useUiStore.getState().openPopover).toBeNull();
  });
});
