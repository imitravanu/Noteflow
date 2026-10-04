import type { SaveStatus } from "../types";

/**
 * The editor's save state machine, extracted so the race-sensitive parts
 * (debounce, in-flight chaining, retry backoff) are unit-testable without a
 * DOM. The editor owns the data (draft/note refs); this gate owns the timing.
 *
 * Guarantees:
 *  - `dirty()` re-arms the debounce on every edit; no edit is scheduled twice.
 *  - `flush()` waits for the active write and any follow-up for edits made
 *    during that write. It returns `true` only when the latest draft is
 *    persisted; on failure it returns `false`, retains dirty state, and keeps
 *    retrying so navigation can stay blocked without losing the draft.
 *  - A failed save re-arms a retry with exponential backoff (1s → 2s → 4s →
 *    cap 5s) instead of silently leaving edits unsaved until the next
 *    keystroke.
 *  - `dispose()` (unmount) stops future retries but never cancels a save
 *    that is already running.
 */
export interface SaveGateOptions {
  /** Attempts the write. Resolves `true` when the note is safely persisted. */
  save: () => Promise<boolean>;
  /** Receives "saving" | "saved" | "error" transitions. */
  onStatus: (status: SaveStatus) => void;
  /** Debounce window before an automatic save. */
  debounceMs?: number;
  /** First retry delay after a failure; doubles up to `maxRetryMs`. */
  initialRetryMs?: number;
  maxRetryMs?: number;
}

export interface SaveGate {
  /** New edits exist: marks dirty and (re)arms the debounced save. */
  dirty(): void;
  /** Saves now (clearing the debounce); true means the latest draft is persisted. */
  flush(): Promise<boolean>;
  /** Whether unsaved edits exist. */
  isDirty(): boolean;
  /** Drops pending work — used when the editor switches to another note. */
  reset(): void;
  /** Unmount: cancel timers/retries; in-flight saves still complete. */
  dispose(): void;
}

export function createSaveGate(options: SaveGateOptions): SaveGate {
  const {
    save,
    onStatus,
    debounceMs = 600,
    initialRetryMs = 1000,
    maxRetryMs = 5000,
  } = options;

  let dirty = false;
  let inflight = false;
  /** A flush arrived mid-save: run one follow-up with the latest draft. */
  let pending = false;
  let disposed = false;
  let retryMs = initialRetryMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Promise of the outermost run. Chained follow-ups are awaited by it, so
   * returning this from a mid-flight `flush()` covers the whole chain.
   */
  let currentRun: Promise<boolean> = Promise.resolve(true);

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const arm = (ms: number) => {
    if (disposed) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, ms);
  };

  async function perform(): Promise<boolean> {
    if (!dirty) return true;
    inflight = true;
    dirty = false;
    onStatus("saving");
    let saved = false;
    let chained: Promise<boolean> | null = null;
    try {
      saved = await save();
      if (saved) {
        retryMs = initialRetryMs; // success resets the backoff
        clearTimer();
        onStatus("saved");
      } else {
        dirty = true; // keep the edits; retry with backoff
        onStatus("error");
        arm(retryMs);
        retryMs = Math.min(retryMs * 2, maxRetryMs);
      }
    } catch {
      // Treat thrown IPC errors like an explicit failed result. A flush caller
      // must be able to keep the current editor open until persistence succeeds.
      saved = false;
      dirty = true;
      onStatus("error");
      arm(retryMs);
      retryMs = Math.min(retryMs * 2, maxRetryMs);
    } finally {
      inflight = false;
      if (pending) {
        pending = false;
        if (dirty) chained = perform();
      }
    }
    // Awaiting the chain is what lets a caller blocked on `currentRun`
    // (flush-during-inflight) know *its* edits landed, not just the first save.
    if (chained) return await chained;
    return saved;
  }

  function flush(): Promise<boolean> {
    clearTimer();
    if (!dirty) return currentRun;
    if (inflight) {
      pending = true;
      return currentRun;
    }
    currentRun = perform();
    return currentRun;
  }

  return {
    dirty() {
      dirty = true;
      // A caller may be waiting on the current flush (for example, a note
      // switch). Ensure edits made while that write is in flight are included
      // in the same awaited flush chain.
      if (inflight) pending = true;
      onStatus("saving");
      arm(debounceMs);
    },
    flush,
    isDirty: () => dirty,
    reset() {
      clearTimer();
      dirty = false;
      pending = false;
      retryMs = initialRetryMs;
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
