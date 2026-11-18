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
      // An "Open" is in progress: the reminder is still scheduled until the
      // editor renders the note, so don't toast it a second time meanwhile.
      if (useUiStore.getState().pendingReminderAck !== null) {
        schedule(FOLLOW_UP_MS);
        return;
      }
      try {
        const due = await api.peekDueReminder();
        if (!alive) return;
        if (due?.reminderAt != null) {
          const expectedAt = due.reminderAt;
          // "Open" is not an acknowledgment: the store navigates to Notes,
          // opens the note, and consumes the reminder only after the editor
          // has rendered it. A failed draft save or note load leaves the
          // schedule in SQLite, so this toast comes back on the follow-up.
          const openReminder = async () => {
            try {
              const opened = await useUiStore.getState().openReminderNote(due.id, expectedAt);
              if (!alive) return;
              if (!opened) {
                useUiStore.getState().showSnackbar(
                  "Couldn't open that reminder. It will stay scheduled.",
                  { replace: true },
                );
                return;
              }
              if (useUiStore.getState().pendingReminderAck === null) {
                await useNotesStore.getState().refresh();
              }
            } catch {
              if (alive) {
                useUiStore.getState().showSnackbar(
                  "Couldn't open that reminder. It will stay scheduled.",
                  { replace: true },
                );
              }
            } finally {
              // Re-check after the open attempt settles (or after the editor
              // acknowledges it), so the toast is never stranded.
              schedule(FOLLOW_UP_MS);
            }
          };
          useUiStore.getState().showSnackbar(`Reminder: ${due.title || "Untitled"}`, {
            actionLabel: "Open",
            persistent: true,
            action: () => void openReminder(),
            onDismiss: (reason) => {
              if (!alive) return;
              if (reason === "action") {
                // openReminder owns the follow-up: it must wait for the note
                // to render (or for the open attempt to fail) first.
                return;
              }
              if (reason === "replaced") {
                schedule(FOLLOW_UP_MS);
                return;
              }
              // Explicit dismissal is the only path that consumes a reminder
              // before its note is opened.
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
