import { useEffect, useRef } from "react";
import { NOTE_COLORS } from "../types";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onClose: () => void;
}

export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="popover color-picker" ref={ref} role="dialog" aria-label="Note color">
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

