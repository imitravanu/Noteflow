const fs = require('fs');

// Fix ColorPicker.tsx
let cpCode = fs.readFileSync('src/components/ColorPicker.tsx', 'utf-8');
cpCode = cpCode.replace(
  '  const ref = useRef<HTMLDivElement>(null);\n  useFocusTrap(ref, onClose);',
  '  const ref = useFocusTrap(true);'
);
fs.writeFileSync('src/components/ColorPicker.tsx', cpCode);

// Fix TagPicker.tsx
let tpCode = fs.readFileSync('src/components/TagPicker.tsx', 'utf-8');
tpCode = tpCode.replace(
  '  const ref = useRef<HTMLDivElement>(null);\n  const inputRef = useRef<HTMLInputElement>(null);\n  useFocusTrap(ref, onClose);',
  '  const ref = useFocusTrap(true);\n  const inputRef = useRef<HTMLInputElement>(null);'
);
fs.writeFileSync('src/components/TagPicker.tsx', tpCode);

