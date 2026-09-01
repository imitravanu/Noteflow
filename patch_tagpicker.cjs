const fs = require('fs');
let code = fs.readFileSync('src/components/TagPicker.tsx', 'utf-8');

code = code.replace(
  'import { useNotesStore } from "../store/notesStore";',
  'import { useNotesStore } from "../store/notesStore";\nimport { useFocusTrap } from "../hooks/useFocusTrap";'
);

code = code.replace(
  '  const ref = useRef<HTMLDivElement>(null);\n  const inputRef = useRef<HTMLInputElement>(null);',
  '  const ref = useRef<HTMLDivElement>(null);\n  const inputRef = useRef<HTMLInputElement>(null);\n  useFocusTrap(ref, onClose);'
);

fs.writeFileSync('src/components/TagPicker.tsx', code);
