import { useRef } from "react";
import { NOTE_COLORS, type NoteColor } from "../types";
import { usePopover } from "../hooks/usePopover";

interface ColorPickerProps {
  value: NoteColor;
  onChange: (color: NoteColor) => void;
  onClose: () => void;
}

export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Escape registration, outside-click close, and focus capture/restore
  // live in usePopover (shared by all pickers).
  usePopover(ref, onClose);

  return (
    <div
      className="popover color-picker"
      ref={ref}
      role="dialog"
      aria-label="Note color"
      // Focusable so usePopover can move focus into the popover on open.
      tabIndex={-1}
    >
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch color-${color}${value === color ? " active" : ""}`}
          aria-label={`Color: ${color}`}
          aria-pressed={value === color}
          title={color === "default" ? "Default" : color}
          onClick={() => {
            onChange(color);
            onClose();
          }}
        />
      ))}
    </div>
  );
}

