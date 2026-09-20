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

/** Plain-text preview of a note body: first non-empty lines, collapsed and markdown cleaned. */
export function bodyPreview(content: string, maxChars = 220): string {
  const cleaned = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s+/gm, "");

  const collapsed = cleaned.replace(/\s+\n/g, "\n").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return collapsed.slice(0, maxChars).trimEnd() + "…";
}

