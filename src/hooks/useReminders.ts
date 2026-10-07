import { useEffect } from "react";
import { api } from "../services/api";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";

const POLL_MS = 30_000;
const FOLLOW_UP_MS = 1_000;

/**
 * Shows one due reminder at a time. A reminder stays in SQLite until its
 * snackbar has actually left the screen. Closing or crashing the app before
 * then causes it to appear again on the next launch instead of being lost.
 */
export function useReminders() {
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const schedule = (delay: number) => {
      if (!alive) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void check(), delay);
    };

    const check = async () => {
      timer = undefined;
      try {
        const due = await api.peekDueReminder();
        if (!alive) return;
        if (due?.reminderAt != null) {
          const expectedAt = due.reminderAt;
          useUiStore.getState().showSnackbar(`Reminder: ${due.title || "Untitled"}`, {
            actionLabel: "Open",
            persistent: true,
            action: () => void useUiStore.getState().openEditor(due.id),
            onDismiss: (reason) => {
              if (!alive) return;
              if (reason === "replaced") {
                schedule(FOLLOW_UP_MS);
                return;
              }
              void api.acknowledgeReminder(due.id, expectedAt)
                .then(() => useNotesStore.getState().refresh())
                .catch(() => {
                  // The schedule remains in SQLite and will be shown again.
                })
                .finally(() => schedule(FOLLOW_UP_MS));
            },
          });
          return;
        }
      } catch {
        // Transient IPC error: no reminder has been consumed.
      }
      schedule(POLL_MS);
    };

    void check();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
}
