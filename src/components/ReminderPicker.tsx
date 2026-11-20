import { useRef, useState } from "react";
import { usePopover } from "../hooks/usePopover";
import {
  fromLocalInputValue,
  isValidReminderTime,
  reminderHintLabels,
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
  const [draft, setDraft] = useState(() =>
    toLocalInputValue(value ?? reminderPresets()[0].at),
  );
  const [pickedPreset, setPickedPreset] = useState<string | null>(null);
  // Escape registration, outside-click close, and focus discipline
  // (shared by all pickers) live in usePopover.
  usePopover(ref, onClose);

  const at = fromLocalInputValue(draft);
  // `datetime-local` has minute precision, so "now" always reads as the past —
  // allow a small grace window instead of rejecting the current minute.
  const valid = isValidReminderTime(at, Date.now() - 60_000);
  const labels = reminderHintLabels(value, at, valid, pickedPreset);

  return (
    <div
      className="popover reminder-picker"
      ref={ref}
      role="dialog"
      aria-label="Note reminder"
      // Focusable so usePopover can move focus into the popover on open.
      tabIndex={-1}
    >
      <div className="reminder-presets">
        {reminderPresets().map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="chip reminder-preset"
            onClick={() => {
              setDraft(toLocalInputValue(preset.at));
              setPickedPreset(preset.label);
            }}
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
        onChange={(e) => {
          setDraft(e.target.value);
          setPickedPreset(null);
        }}
      />

      <p className="reminder-hint">
        <span>{labels.scheduled}</span>
        {labels.proposed && (
          <span className="reminder-proposed">{labels.proposed}</span>
        )}
        {at !== null && !valid && (
          <span> · choose a time in the future</span>
        )}
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
