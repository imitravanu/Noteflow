import { describe, expect, it } from "vitest";
import { bodyPreview, highlightParts } from "./highlight";

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
});

describe("bodyPreview", () => {
  it("collapses trailing whitespace before newlines", () => {
    expect(bodyPreview("line one   \n   line two")).toBe("line one\n   line two");
  });

  it("truncates long bodies with an ellipsis", () => {
    const long = "x".repeat(300);
    const out = bodyPreview(long);
    expect(out.length).toBe(221);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns short bodies untouched", () => {
    expect(bodyPreview("short note")).toBe("short note");
  });
});

