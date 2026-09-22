/**
 * Reminder helpers, kept DOM-free so they are unit-testable:
 * label formatting for cards/tooltips, and the conversion between epoch
 * milliseconds and the value an `<input type="datetime-local">` expects
 * (local wall-clock, no timezone suffix).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Compact label for a reminder: "Overdue", "in 25m", "in 3h", "Fri 09:00". */
export function formatReminderTime(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Reminder";
  const diff = timestamp - now;
  if (diff <= 0) return "Overdue";
  if (diff < MINUTE) return "in <1m";
  if (diff < HOUR) return `in ${Math.floor(diff / MINUTE)}m`;

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "Reminder";
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return `in ${Math.floor(diff / HOUR)}h`;

  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();
  if (isTomorrow) return `tomorrow ${time}`;

  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  })}, ${time}`;
}

/** True when a reminder should still be scheduled (a past time is not one). */
export function isValidReminderTime(timestamp: number | null, now: number = Date.now()): boolean {
  return timestamp !== null && Number.isFinite(timestamp) && timestamp > now;
}

/** Epoch ms -> the local `YYYY-MM-DDTHH:MM` string a datetime-local input wants. */
export function toLocalInputValue(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value -> epoch ms, or null when the field is empty/invalid. */
export function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Quick picks offered above the datetime field. */
export function reminderPresets(now: number = Date.now()): { label: string; at: number }[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { label: "In 1 hour", at: now + HOUR },
    { label: "Tomorrow 9:00", at: tomorrow.getTime() },
  ];
}
