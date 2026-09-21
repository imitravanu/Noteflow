import { describe, expect, it } from "vitest";
import { buildBackupPayload, parseBackupJson } from "./backup";
import type { Note } from "../types";

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
  it("accepts wrapped and raw shapes", () => {
    const wrapped = JSON.stringify({ version: "1.2.0", notes: [note("a")] });
    expect(parseBackupJson(wrapped).map((n) => n.id)).toEqual(["a"]);

    const raw = JSON.stringify([note("b")]);
    expect(parseBackupJson(raw).map((n) => n.id)).toEqual(["b"]);
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
