import { describe, expect, it } from "vitest";
import {
  formatReminderTime,
  fromLocalInputValue,
  isValidReminderTime,
  reminderHintLabels,
  reminderPresets,
  toLocalInputValue,
} from "./reminder";

const NOW = new Date("2026-08-23T12:00:00").getTime();

describe("formatReminderTime", () => {
  it("labels a past reminder as overdue", () => {
    expect(formatReminderTime(NOW - 1, NOW)).toBe("Overdue");
    expect(formatReminderTime(NOW, NOW)).toBe("Overdue");
  });

  it("counts down in minutes and hours within the same day", () => {
    expect(formatReminderTime(NOW + 25 * 60_000, NOW)).toBe("in 25m");
    expect(formatReminderTime(NOW + 3 * 3_600_000, NOW)).toBe("in 3h");
  });

  it("names tomorrow, then falls back to a dated label", () => {
    const tomorrow9 = new Date(NOW);
    tomorrow9.setDate(tomorrow9.getDate() + 1);
    tomorrow9.setHours(9, 0, 0, 0);
    expect(formatReminderTime(tomorrow9.getTime(), NOW)).toMatch(/^tomorrow /);

    const nextMonth = new Date(NOW);
    nextMonth.setDate(nextMonth.getDate() + 20);
    const label = formatReminderTime(nextMonth.getTime(), NOW);
    // Locale-dependent date + time text, but never a countdown or "tomorrow".
    expect(label).toContain(":");
    expect(label).not.toMatch(/tomorrow|overdue|^in /i);
  });

  it("never throws on missing timestamps", () => {
    expect(formatReminderTime(NaN, NOW)).toBe("Reminder");
    expect(formatReminderTime(0, NOW)).toBe("Reminder");
    expect(formatReminderTime(-5, NOW)).toBe("Reminder");
  });
});

describe("isValidReminderTime", () => {
  it("only accepts a scheduled time in the future", () => {
    expect(isValidReminderTime(NOW + 60_000, NOW)).toBe(true);
    expect(isValidReminderTime(NOW - 60_000, NOW)).toBe(false);
    expect(isValidReminderTime(NOW, NOW)).toBe(false);
    expect(isValidReminderTime(null, NOW)).toBe(false);
    expect(isValidReminderTime(NaN, NOW)).toBe(false);
  });
});

describe("datetime-local conversion", () => {
  it("round-trips a timestamp to the minute", () => {
    const ms = new Date(2026, 7, 23, 9, 5, 30).getTime();
    expect(toLocalInputValue(ms)).toBe("2026-08-23T09:05");
    expect(fromLocalInputValue(toLocalInputValue(ms))).toBe(
      new Date(2026, 7, 23, 9, 5).getTime(),
    );
  });

  it("degrades gracefully on empty or invalid input", () => {
    expect(toLocalInputValue(NaN)).toBe("");
    expect(toLocalInputValue(0)).toBe("");
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("not-a-date")).toBeNull();
  });
});

describe("reminderHintLabels", () => {
  it("distinguishes a proposed preset from an already saved reminder", () => {
    const proposedAt = NOW + 3_600_000;
    expect(reminderHintLabels(null, proposedAt, true, "In 1 hour", NOW)).toEqual({
      scheduled: "No reminder saved yet",
      proposed: expect.stringMatching(/^Proposed \(In 1 hour\): .* — not saved yet$/),
    });

    const saved = NOW - 60_000;
    expect(reminderHintLabels(saved, proposedAt, true, "Tomorrow 9:00", NOW)).toEqual({
      scheduled: expect.stringMatching(/^Currently scheduled: Overdue · /),
      proposed: expect.stringMatching(/^Proposed \(Tomorrow 9:00\): .* — not saved yet$/),
    });
  });

  it("shows no proposal for an invalid or unchanged time", () => {
    expect(reminderHintLabels(null, NOW - 1, false, null, NOW).proposed).toBeNull();
    expect(reminderHintLabels(NOW + 1, NOW + 1, true, null, NOW).proposed).toBeNull();
  });
});

describe("reminderPresets", () => {
  it("offers a near and a next-morning option, both in the future", () => {
    const presets = reminderPresets(NOW);
    expect(presets.map((p) => p.label)).toEqual(["In 1 hour", "Tomorrow 9:00"]);
    expect(presets[0].at).toBe(NOW + 3_600_000);
    const tomorrow = new Date(presets[1].at);
    expect(tomorrow.getHours()).toBe(9);
    expect(tomorrow.getDate()).toBe(new Date(NOW).getDate() + 1);
    for (const preset of presets) expect(preset.at).toBeGreaterThan(NOW);
  });
});
