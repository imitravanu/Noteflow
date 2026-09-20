import { describe, expect, it } from "vitest";
import { countWordsAndChars, formatDateTime, formatRelativeTime, noteToMarkdown } from "./format";

const NOW = new Date("2026-08-23T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("shows 'just now' under a minute", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
  });

  it("shows minutes and hours", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
  });

  it("shows days within a week", () => {
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2 d ago");
  });

  it("falls back to a locale date beyond a week", () => {
    const out = formatRelativeTime(NOW - 30 * 86_400_000, NOW);
    expect(out).toMatch(/Jul/);
    expect(out).not.toMatch(/ago/);
  });

  it("includes the year once it differs from the current one", () => {
    const out = formatRelativeTime(NOW - 400 * 86_400_000, NOW);
    expect(out).toMatch(/2025/);
  });
});

describe("countWordsAndChars", () => {
  it("handles empty note content", () => {
    expect(countWordsAndChars("", [])).toEqual({ words: 0, chars: 0 });
  });

  it("counts words and characters accurately", () => {
    const result = countWordsAndChars("Hello world", [{ text: "Buy milk" }]);
    expect(result.words).toBe(4);
    expect(result.chars).toBe(20);
  });
});

describe("noteToMarkdown", () => {
  it("formats title, tags, content, and checklist", () => {
    const md = noteToMarkdown({
      title: "My Note",
      content: "Here is some content.",
      tags: [{ name: "work" }, { name: "ideas" }],
      checklist: [
        { text: "Item 1", checked: false },
        { text: "Item 2", checked: true },
      ],
    });

    expect(md).toContain("# My Note");
    expect(md).toContain("#work #ideas");
    expect(md).toContain("Here is some content.");
    expect(md).toContain("- [ ] Item 1");
    expect(md).toContain("- [x] Item 2");
  });
});

describe("timestamp resilience", () => {
  it("formatRelativeTime safely handles NaN and negative timestamps without RangeError", () => {
    expect(formatRelativeTime(NaN, NOW)).toBe("just now");
    expect(formatRelativeTime(-100, NOW)).toBe("just now");
    expect(formatRelativeTime(0, NOW)).toBe("just now");
  });

  it("formatDateTime safely handles NaN and non-finite timestamps", () => {
    expect(formatDateTime(NaN)).toBe("—");
    expect(formatDateTime(0)).toBe("—");
    expect(formatDateTime(-999)).toBe("—");
    expect(formatDateTime(NOW)).toMatch(/2026/);
  });
});



