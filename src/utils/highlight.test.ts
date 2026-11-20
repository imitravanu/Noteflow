import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "../types";
import { bodyPreview, checklistPreview, highlightParts } from "./highlight";

describe("highlightParts", () => {
  it("returns null for empty or missing query", () => {
    expect(highlightParts("hello", "")).toBeNull();
    expect(highlightParts("hello", null)).toBeNull();
    expect(highlightParts("hello", undefined)).toBeNull();
    expect(highlightParts("", "q")).toBeNull();
  });

  it("marks a simple case-insensitive match", () => {
    const parts = highlightParts("Quarterly Report", "quarter")!;
    expect(parts).toEqual([
      { text: "Quarter", match: true },
      { text: "ly Report", match: false },
    ]);
  });

  it("marks multiple occurrences", () => {
    const parts = highlightParts("tea for two at tea time", "tea")!;
    expect(parts.filter((p) => p.match)).toHaveLength(2);
    expect(parts.filter((p) => !p.match).map((p) => p.text).join("")).toBe(" for two at  time");
  });

  it("handles a full-string match", () => {
    expect(highlightParts("abc", "abc")).toEqual([{ text: "abc", match: true }]);
  });

  it("returns null when nothing matches", () => {
    expect(highlightParts("abc", "xyz")).toBeNull();
  });

  it("bails out safely when unicode case-folding changes string length", () => {
    // "İ" (U+0130) lowercases to two code units ("i̇"), so offsets computed
    // on the folded text would mis-slice the original. Plain text wins.
    expect(highlightParts("İstanbul office", "İ")).toBeNull();
    expect(highlightParts("İstanbul office", "i")).toBeNull();
  });

  it("still highlights length-stable unicode", () => {
    const parts = highlightParts("Grüß Gott", "ü")!;
    expect(parts).toEqual([
      { text: "Gr", match: false },
      { text: "ü", match: true },
      { text: "ß Gott", match: false },
    ]);
  });
});

describe("bodyPreview", () => {
  it("collapses display whitespace", () => {
    expect(bodyPreview("line one   \r\n\t line two")).toBe("line one line two");
  });

  it("collapses pasted columns before applying the character limit", () => {
    const columnGap = " ".repeat(32);
    const row = ["Review", "Ana", "Fri"].join(columnGap);
    const pastedTable = Array(12).fill(row).join("\n");
    expect(bodyPreview(pastedTable)).toBe(Array(12).fill("Review Ana Fri").join(" "));
  });

  it("does not add a premature ellipsis to a body that fits the card", () => {
    // The card clamps by *lines*; adding "…" here as well would show an
    // ellipsis even when nothing was omitted. The char cap stays out of the
    // way of ordinary notes and long paragraphs.
    const out = bodyPreview("x".repeat(300));
    expect(out.length).toBe(300);
    expect(out.endsWith("…")).toBe(false);
  });

  it("only truncates past the generous safety cap", () => {
    const out = bodyPreview("x".repeat(700));
    expect(out.length).toBe(601);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns short bodies untouched", () => {
    expect(bodyPreview("short note")).toBe("short note");
  });

  it("strips common markdown formatting from previews", () => {
    expect(bodyPreview("# Title\n**bold** and `code`")).toBe("Title bold and code");
  });
});

describe("checklistPreview", () => {
  const items: ChecklistItem[] = [
    { id: "a", text: "Draft release notes", checked: true },
    { id: "b", text: "Verify package signature before publishing", checked: false },
    { id: "c", text: "Upload the signed build", checked: false },
  ];

  it("names the next unchecked task with progress left to the count", () => {
    expect(checklistPreview(items)).toEqual({
      text: "Verify package signature before publishing",
      matched: false,
      allDone: false,
    });
  });

  it("shows a search-matched item even when an earlier one is unchecked", () => {
    expect(checklistPreview(items, "verify package")).toEqual({
      text: "Verify package signature before publishing",
      matched: true,
      allDone: false,
    });
    expect(checklistPreview(items, "DRAFT")).toMatchObject({
      text: "Draft release notes",
      matched: true,
    });
  });

  it("handles a fully completed checklist gracefully", () => {
    expect(checklistPreview(items.map((i) => ({ ...i, checked: true })))).toEqual({
      text: "All items complete",
      matched: false,
      allDone: true,
    });
  });

  it("is case-insensitive and ignores surrounding whitespace in the query", () => {
    expect(checklistPreview(items, "  UPLOAD  ").matched).toBe(true);
    expect(checklistPreview(items, "not present").matched).toBe(false);
  });

  it("returns nothing for an empty checklist", () => {
    expect(checklistPreview([])).toEqual({ text: "", matched: false, allDone: false });
  });
});

