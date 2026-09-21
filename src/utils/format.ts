/** Compact relative timestamps for note cards ("just now", "3 d ago"). */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "just now";
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} d ago`;

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "just now";
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Computes word and character counts across note body and checklist. */
export function countWordsAndChars(
  content: string,
  checklist: { text: string }[] = [],
): { words: number; chars: number } {
  const combined = [content, ...checklist.map((c) => c.text)]
    .filter(Boolean)
    .join(" ");

  const trimmed = combined.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const chars = combined.length;

  return { words, chars };
}

/** Formats a note and its checklist/tags into clean Markdown. */
export function noteToMarkdown(note: {
  title: string;
  content: string;
  checklist?: { text: string; checked: boolean }[];
  tags?: { name: string }[];
  createdAt?: number;
  updatedAt?: number;
}): string {
  const lines: string[] = [];

  if (note.title.trim()) {
    lines.push(`# ${note.title.trim()}`, "");
  }

  if (note.tags && note.tags.length > 0) {
    lines.push(note.tags.map((t) => `#${t.name}`).join(" "), "");
  }

  if (note.content.trim()) {
    lines.push(note.content.trim(), "");
  }

  if (note.checklist && note.checklist.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    for (const item of note.checklist) {
      lines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** Triggers a browser/webview local file download. */
export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the webview has had a chance to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}


