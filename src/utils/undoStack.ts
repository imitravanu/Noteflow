export interface UndoEntry {
  /** Stable identifier so snackbar "Undo" buttons can target one exact action. */
  id: number;
  /** Short description shown in "Undid {label}" feedback. */
  label: string;
  /** Reverses the action; must be safe to run once. */
  undo: () => Promise<void> | void;
}

/** An undo entry as provided by callers; `push` assigns the stable id. */
export type UndoEntryInput = Omit<UndoEntry, "id">;

/**
 * Bounded undo stack for reversible note actions (trash, archive, pin…).
 * Pure data structure — callers wire it to real database operations.
 */
export class UndoStack {
  private entries: UndoEntry[] = [];
  private cap: number;
  private nextId = 1;

  constructor(capacity = 50) {
    this.cap = capacity;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Adds an entry and returns its stable id. */
  push(entry: UndoEntryInput): number {
    const id = this.nextId++;
    this.entries.push({ ...entry, id });
    if (this.entries.length > this.cap) {
      this.entries.shift();
    }
    return id;
  }

  pop(): UndoEntry | null {
    return this.entries.pop() ?? null;
  }

  /**
   * Removes (but does not run) the entry with the given id so a snackbar
   * "Undo" button can reverse exactly the action it was shown for. Returns
   * null when that entry is already gone (e.g. already undone).
   */
  removeById(id: number): UndoEntry | null {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) return null;
    return this.entries.splice(index, 1)[0];
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * Computes the id set after a shift-click range selection over `orderedIds`.
 * The range spans from the anchor (or the toggled id when no anchor exists)
 * to the clicked id, unioned with the current selection.
 */
export function expandRangeSelection(
  orderedIds: string[],
  anchorId: string | null,
  clickedId: string,
  currentSelection: Iterable<string>,
): Set<string> {
  const result = new Set(currentSelection);
  const anchorIndex = anchorId
    ? orderedIds.indexOf(anchorId)
    : orderedIds.indexOf(clickedId);
  const clickedIndex = orderedIds.indexOf(clickedId);
  if (anchorIndex === -1 || clickedIndex === -1) {
    result.add(clickedId);
    return result;
  }
  const start = Math.min(anchorIndex, clickedIndex);
  const end = Math.max(anchorIndex, clickedIndex);
  for (let i = start; i <= end; i++) {
    result.add(orderedIds[i]);
  }
  return result;
}

