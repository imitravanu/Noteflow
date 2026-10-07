import { describe, expect, it } from "vitest";
import { buildBackupPayload, parseBackupJson } from "./backup";
import type { Note, Tag } from "../types";

function note(id: string): Note {
  return {
    id,
    title: "t",
    content: "c",
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
  };
}

describe("parseBackupJson", () => {
  it("accepts wrapped (with/without tags) and raw shapes", () => {
    const wrapped = JSON.stringify({ version: "1.2.0", notes: [note("a")] });
    const parsed = parseBackupJson(wrapped);
    expect(parsed.notes).toMatchObject([{ id: "a" }]);
    expect(parsed.tags).toBeUndefined(); // v1.3.0 backups: no top-level tags

    const withTags = JSON.stringify({
      notes: [note("b")],
      tags: [{ id: "t1", name: "work" }] satisfies Tag[],
    });
    const p2 = parseBackupJson(withTags);
    expect(p2.notes).toMatchObject([{ id: "b" }]);
    expect(p2.tags).toEqual([{ id: "t1", name: "work" }]);

    const raw = JSON.stringify([note("c")]);
    expect(parseBackupJson(raw).notes).toMatchObject([{ id: "c" }]);

    expect(parseBackupJson(JSON.stringify({ notes: [note("d")], tags: { bad: true } })).tags)
      .toEqual([{ bad: true }]);
  });

  it("rejects non-backup files", () => {
    expect(() => parseBackupJson(JSON.stringify({ foo: 1 }))).toThrow();
    expect(() => parseBackupJson("not json")).toThrow();
  });
});

describe("buildBackupPayload", () => {
  it("stamps counts and version", () => {
    const payload = buildBackupPayload([note("a"), note("b")], [], "1.2.0");
    expect(payload.notesCount).toBe(2);
    expect(payload.version).toBe("1.2.0");
    expect(payload.exportedAt).toMatch(/^\d{4}-/);
  });
});
