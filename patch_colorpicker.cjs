const fs = require('fs');
let code = fs.readFileSync('src/components/ColorPicker.tsx', 'utf-8');

code = code.replace(
  'import { useEffect, useRef } from "react";\nimport { NOTE_COLORS } from "../types";',
  `import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { NOTE_COLORS } from "../types";
import { useFocusTrap } from "../hooks/useFocusTrap";`
);

code = code.replace(
  'export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {\n  const ref = useRef<HTMLDivElement>(null);',
  `export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);`
);

code = code.replace(
  '    const onKey = (e: KeyboardEvent) => {\n      if (e.key === "Escape") onClose();\n    };',
  `    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (!ref.current) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const swatches = Array.from(ref.current.querySelectorAll('.color-swatch')) as HTMLElement[];
        const currentIndex = swatches.findIndex(el => el === document.activeElement);
        if (currentIndex !== -1) {
          let nextIndex = e.key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;
          if (nextIndex >= swatches.length) nextIndex = 0;
          if (nextIndex < 0) nextIndex = swatches.length - 1;
          swatches[nextIndex].focus();
        } else if (swatches.length > 0) {
          swatches[0].focus();
        }
      }
    };`
);

code = code.replace(
  '          onClick={() => {\n            onChange(color);\n            onClose();\n          }}\n        />',
  `          onClick={() => {
            onChange(color);
            onClose();
          }}
        >
          {value === color && <Check size={14} className="color-swatch-check" />}
        </button>`
);

fs.writeFileSync('src/components/ColorPicker.tsx', code);
