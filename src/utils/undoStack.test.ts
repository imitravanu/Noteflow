import { describe, expect, it } from "vitest";
import { UndoStack, expandRangeSelection } from "./undoStack";

describe("UndoStack", () => {
  it("pops in LIFO order", () => {
    const stack = new UndoStack();
    const calls: string[] = [];
    stack.push({ label: "first", undo: () => void calls.push("first") });
    stack.push({ label: "second", undo: () => void calls.push("second") });

    expect(stack.size).toBe(2);
    stack.pop()?.undo();
    stack.pop()?.undo();
    expect(calls).toEqual(["second", "first"]);
    expect(stack.size).toBe(0);
    expect(stack.pop()).toBeNull();
  });

  it("caps its capacity, dropping the oldest entry", () => {
    const stack = new UndoStack(2);
    stack.push({ label: "1", undo: () => {} });
    stack.push({ label: "2", undo: () => {} });
    stack.push({ label: "3", undo: () => {} });

    expect(stack.size).toBe(2);
    expect(stack.pop()?.label).toBe("3");
    expect(stack.pop()?.label).toBe("2");
  });

  it("clear removes everything", () => {
    const stack = new UndoStack();
    stack.push({ label: "x", undo: () => {} });
    stack.clear();
    expect(stack.size).toBe(0);
  });

  it("removeById pulls one specific entry without disturbing the rest", () => {
    const stack = new UndoStack();
    const idA = stack.push({ label: "a", undo: () => {} });
    const idB = stack.push({ label: "b", undo: () => {} });

    expect(stack.removeById(idA)?.label).toBe("a");
    expect(stack.size).toBe(1);
    expect(stack.removeById(999)).toBeNull();
    expect(stack.removeById(idB)?.label).toBe("b");
    expect(stack.size).toBe(0);
    expect(stack.pop()).toBeNull();
  });
});

describe("expandRangeSelection", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("selects the range from anchor to clicked item", () => {
    const result = expandRangeSelection(ids, "a", "c", []);
    expect([...result]).toEqual(["a", "b", "c"]);
  });

  it("works when shifting upwards", () => {
    const result = expandRangeSelection(ids, "d", "b", []);
    expect([...result]).toEqual(["b", "c", "d"]);
  });

  it("unions with the existing selection", () => {
    const result = expandRangeSelection(ids, "a", "c", new Set(["e"]));
    expect([...result].sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("falls back to a single toggle for unknown ids", () => {
    const result = expandRangeSelection(ids, "zzz", "c", []);
    expect([...result]).toEqual(["c"]);
  });
});

