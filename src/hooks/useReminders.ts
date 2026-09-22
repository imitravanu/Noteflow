import { useEffect } from "react";
import { api } from "../services/api";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";

/** How often the app checks for reminders that have come due. */
const POLL_MS = 30_000;
/** Backlog drain: check again soon after a reminder fired, so several due
 *  reminders surface in sequence instead of 30s apart. */
const FOLLOW_UP_MS = 4_000;

/**
 * Fires due reminders. The backend hands out (and clears) at most one reminder
 * per call, which is what makes firing exactly-once: no double toast, and a
 * reminder that came due while the app was closed is still announced at the
 * next launch instead of silently expiring.
 */
export function useReminders() {
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const check = async () => {
      let fired = false;
      try {
        const due = await api.takeDueReminder();
        if (!alive) return;
        if (due) {
          fired = true;
          const ui = useUiStore.getState();
          // The list (and its bell badges) must reflect that the reminder is
          // spent, even if the note itself is not open.
          void useNotesStore.getState().refresh();
          ui.showSnackbar(`Reminder: ${due.title || "Untitled"}`, {
            actionLabel: "Open",
            action: () => useUiStore.getState().openEditor(due.id),
          });
        }
      } catch {
        /* transient IPC failure: the next poll retries, nothing is consumed */
      }
      if (!alive) return;
      timer = window.setTimeout(check, fired ? FOLLOW_UP_MS : POLL_MS);
    };

    void check(); // catch reminders that came due while the app was closed
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
}
