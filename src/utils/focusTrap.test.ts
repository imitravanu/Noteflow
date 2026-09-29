import { describe, expect, it } from "vitest";
import { nextFocusableIndex } from "./focusTrap";

// The trap hook itself needs a DOM; the cycle math it is built on does not,
// so the wrap-around contract is tested here.

describe("nextFocusableIndex", () => {
  it("walks forward and wraps at the end", () => {
    expect(nextFocusableIndex(3, 0, false)).toBe(1);
    expect(nextFocusableIndex(3, 1, false)).toBe(2);
    expect(nextFocusableIndex(3, 2, false)).toBe(0); // wrap
  });

  it("walks backward and wraps at the start", () => {
    expect(nextFocusableIndex(3, 2, true)).toBe(1);
    expect(nextFocusableIndex(3, 1, true)).toBe(0);
    expect(nextFocusableIndex(3, 0, true)).toBe(2); // wrap
  });

  it("enters from outside at first / last", () => {
    expect(nextFocusableIndex(3, -1, false)).toBe(0);
    expect(nextFocusableIndex(3, -1, true)).toBe(2);
  });

  it("handles a single focusable as a self-cycle", () => {
    expect(nextFocusableIndex(1, 0, false)).toBe(0);
    expect(nextFocusableIndex(1, 0, true)).toBe(0);
  });

  it("returns -1 when the container has no focusables", () => {
    expect(nextFocusableIndex(0, -1, false)).toBe(-1);
    expect(nextFocusableIndex(0, 0, true)).toBe(-1);
  });
});
