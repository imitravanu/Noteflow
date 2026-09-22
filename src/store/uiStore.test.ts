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
    openPopover: null,
  });
  useUiStore.getState().undoStack.clear();
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
