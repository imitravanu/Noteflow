import { describe, expect, it } from "vitest";
import { shouldShowNewNote } from "./createAction";

const emptyAll = {
  page: "notes" as const,
  view: "all" as const,
  query: "",
  activeTagId: null,
  totalNotes: 0,
};

describe("shouldShowNewNote", () => {
  it("hides the global action only on the empty All Notes screen, which has its own create button", () => {
    expect(shouldShowNewNote(emptyAll)).toBe(false);
    expect(shouldShowNewNote({ ...emptyAll, totalNotes: 1 })).toBe(true);
  });

  it("keeps a create action visible after the last active note is archived", () => {
    // counts.all excludes archived and trashed notes: it is 0 even though
    // Archive still has rows and shows no create affordance of its own.
    expect(shouldShowNewNote({ ...emptyAll, view: "archive" })).toBe(true);
    expect(shouldShowNewNote({ ...emptyAll, view: "trash" })).toBe(true);
    expect(shouldShowNewNote({ ...emptyAll, view: "favorites" })).toBe(true);
    expect(shouldShowNewNote({ ...emptyAll, view: "pinned" })).toBe(true);
  });

  it("keeps it visible on an empty tag view and an empty search result", () => {
    expect(shouldShowNewNote({ ...emptyAll, activeTagId: "tag-design" })).toBe(true);
    expect(shouldShowNewNote({ ...emptyAll, query: "zzzzz" })).toBe(true);
    expect(shouldShowNewNote({ ...emptyAll, query: "   " })).toBe(false);
  });

  it("is always available from Settings", () => {
    expect(shouldShowNewNote({ ...emptyAll, page: "settings" })).toBe(true);
    expect(
      shouldShowNewNote({ ...emptyAll, page: "settings", view: "archive", query: "x" }),
    ).toBe(true);
  });
});
