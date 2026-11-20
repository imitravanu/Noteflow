import type { ChecklistItem } from "../types";

export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into parts marking case-insensitive occurrences of `query`,
 * ready to render with `<mark>` styling. Returns null when there is nothing
 * to highlight so callers can render a plain string.
 */
export function highlightParts(
  text: string,
  query: string | null | undefined,
): HighlightPart[] | null {
  const q = (query ?? "").trim();
  if (!q || !text) return null;

  const lowerText = text.toLowerCase();
  const lowerQuery = q.toLowerCase();
  // Case-folding can change string length for some unicode (e.g. "İ" folds to
  // two code units), which would silently mis-slice the original text. Bail
  // out to plain rendering rather than highlight the wrong characters.
  if (lowerText.length !== text.length || lowerQuery.length !== q.length) {
    return null;
  }
  const parts: HighlightPart[] = [];

  let cursor = 0;
  let idx = lowerText.indexOf(lowerQuery, cursor);
  while (idx !== -1) {
    if (idx > cursor) {
      parts.push({ text: text.slice(cursor, idx), match: false });
    }
    parts.push({ text: text.slice(idx, idx + q.length), match: true });
    cursor = idx + q.length;
    idx = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }
  return parts.some((p) => p.match) ? parts : null;
}

/**
 * Plain-text preview of a note body. Collapse display whitespace before
 * applying the character cap so pasted columns use the same budget as
 * ordinary text. The card clamps the result to the lines it can display.
 */
export function bodyPreview(content: string, maxChars = 600): string {
  const cleaned = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s+/gm, "");

  const collapsed = cleaned.replace(/[ \t\r\n\f]+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return collapsed.slice(0, maxChars).trimEnd() + "…";
}

export interface ChecklistPreview {
  text: string;
  /** The text came from a checklist item matching the active search query. */
  matched: boolean;
  /** Every item is checked — `text` is a completion label, not a task. */
  allDone: boolean;
}

/**
 * The line a card uses to explain a checklist. A search-matched item wins over
 * the next unchecked task so a card that appeared in search results shows
 * *why* it matched without opening it. The item still needs <Highlighted> at
 * the call site so the matching words are marked.
 */
export function checklistPreview(
  items: ChecklistItem[],
  query?: string | null,
): ChecklistPreview {
  if (items.length === 0) return { text: "", matched: false, allDone: false };

  const q = (query ?? "").trim().toLowerCase();
  if (q) {
    const match = items.find((item) => item.text.toLowerCase().includes(q));
    if (match) return { text: match.text, matched: true, allDone: false };
  }

  const next = items.find((item) => !item.checked);
  if (next) return { text: next.text, matched: false, allDone: false };
  return { text: "All items complete", matched: false, allDone: true };
}

