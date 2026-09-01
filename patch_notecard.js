const fs = require('fs');
let code = fs.readFileSync('src/components/NoteCard.tsx', 'utf-8');

code = code.replace(
  'interface NoteCardProps {\n  note: Note;\n  selected: boolean;\n  orderedIds: string[];\n  query: string;\n}',
  'interface NoteCardProps {\n  note: Note;\n  selected: boolean;\n  orderedIds: string[];\n  query: string;\n  tabIndex?: number;\n  onFocus?: () => void;\n}'
);

code = code.replace(
  'export function NoteCard({ note, selected, orderedIds, query }: NoteCardProps) {',
  'export function NoteCard({ note, selected, orderedIds, query, tabIndex = -1, onFocus }: NoteCardProps) {'
);

code = code.replace(
  'tabIndex={0}',
  'tabIndex={tabIndex}\n      onFocus={onFocus}'
);

fs.writeFileSync('src/components/NoteCard.tsx', code);
