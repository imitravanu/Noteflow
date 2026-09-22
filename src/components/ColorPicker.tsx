import { useEffect, useId, useRef } from "react";
import { NOTE_COLORS } from "../types";
import { useUiStore } from "../store/uiStore";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onClose: () => void;
}

export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  // Always call the latest onClose (it is re-created every render).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape is owned by the global cascade (see utils/escape.ts): register so
  // it closes *this* popover instead of the editor underneath it.
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

