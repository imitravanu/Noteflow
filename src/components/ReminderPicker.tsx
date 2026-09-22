import { useEffect, useId, useRef, useState } from "react";
import { useUiStore } from "../store/uiStore";
import {
  formatReminderTime,
  fromLocalInputValue,
  isValidReminderTime,
  reminderPresets,
  toLocalInputValue,
} from "../utils/reminder";

interface ReminderPickerProps {
  /** The note's current reminder (epoch ms), or null when none is scheduled. */
  value: number | null;
  /** `null` clears the reminder; a timestamp schedules (or reschedules) it. */
  onSet: (at: number | null) => void;
  onClose: () => void;
}

/** One-shot reminder picker: quick presets, an exact time, and a clear action. */
export function ReminderPicker({ value, onSet, onClose }: ReminderPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  // Always call the latest onClose (it is re-created every render).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [draft, setDraft] = useState(() =>
    toLocalInputValue(value ?? reminderPresets()[0].at),
  );

  // Escape is owned by the global cascade (see utils/escape.ts): register so it
  // closes *this* popover instead of the editor underneath it.
  useEffect(() => {
    const { registerPopover, unregisterPopover } = useUiStore.getState();
    registerPopover(id, () => closeRef.current());
    return () => unregisterPopover(id);
  }, [id]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const at = fromLocalInputValue(draft);
  // `datetime-local` has minute precision, so "now" always reads as the past —
  // allow a small grace window instead of rejecting the current minute.
  const valid = isValidReminderTime(at, Date.now() - 60_000);

  return (
    <div className="popover reminder-picker" ref={ref} role="dialog" aria-label="Note reminder">
      <div className="reminder-presets">
        {reminderPresets().map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="chip reminder-preset"
            onClick={() => setDraft(toLocalInputValue(preset.at))}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <input
        className="reminder-input"
        type="datetime-local"
        value={draft}
        aria-label="Reminder date and time"
        onChange={(e) => setDraft(e.target.value)}
      />

      <p className="reminder-hint">
        {value !== null ? `Scheduled ${formatReminderTime(value)}` : "No reminder set"}
        {at !== null && !valid ? " · choose a time in the future" : ""}
      </p>

      <div className="reminder-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!valid}
          onClick={() => {
            if (at === null) return;
            onSet(at);
            onClose();
          }}
        >
          {value !== null ? "Update reminder" : "Set reminder"}
        </button>
        {value !== null && (
          <button
            type="button"
            className="btn btn-ghost danger"
            onClick={() => {
              onSet(null);
              onClose();
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
