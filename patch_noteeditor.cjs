const fs = require('fs');
let code = fs.readFileSync('src/components/NoteEditor.tsx', 'utf-8');

code = code.replace(
  'setEditorNote((prev) => prev ? { ...prev, reminderAt: ts } : prev);',
  'setEditorNote(note ? { ...note, reminderAt: ts } : null);'
);

code = code.replace(
  'setEditorNote((prev) => prev ? { ...prev, reminderAt: null } : prev);',
  'setEditorNote(note ? { ...note, reminderAt: null } : null);'
);

fs.writeFileSync('src/components/NoteEditor.tsx', code);
