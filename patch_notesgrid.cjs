const fs = require('fs');
let code = fs.readFileSync('src/components/NotesGrid.tsx', 'utf-8');

code = code.replace(
  'const PAGE_SIZE = 60;',
  'import { PAGE_SIZE } from "../constants";'
);

code = code.replace(
  'export function NotesGrid({ notes, showPinnedSection }: NotesGridProps) {\n  const query = useUiStore((s) => s.query);\n  const selection = useUiStore((s) => s.selection);\n  const orderedIds = useMemo(() => notes.map((n) => n.id), [notes]);',
  `export function NotesGrid({ notes, showPinnedSection }: NotesGridProps) {
  const query = useUiStore((s) => s.query);
  const selection = useUiStore((s) => s.selection);
  const orderedIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);`
);

// We need to calculate all visible cards
//   const pinned = showPinnedSection ? notes.filter((n) => n.pinned) : [];
//   const regular = showPinnedSection ? notes.filter((n) => !n.pinned) : notes;
//   const visibleRegular = regular.slice(0, visibleCount);
//   const selectedSet = useMemo(() => new Set(selection), [selection]);
// visible list is pinned + visibleRegular
code = code.replace(
  '  const selectedSet = useMemo(() => new Set(selection), [selection]);\n\n  const renderCards = (list: Note[]) =>\n    list.map((note) => (\n      <NoteCard\n        key={note.id}\n        note={note}\n        selected={selectedSet.has(note.id)}\n        orderedIds={orderedIds}\n        query={query}\n      />\n    ));',
  `  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const visibleList = useMemo(() => [...pinned, ...visibleRegular], [pinned, visibleRegular]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (visibleList.length === 0) return;
    
    let cols = 1;
    if (containerRef.current) {
      const grids = containerRef.current.querySelectorAll('.notes-grid');
      if (grids.length > 0) {
        const style = window.getComputedStyle(grids[0]);
        cols = style.gridTemplateColumns.split(' ').length || 1;
      }
    }

    let nextIndex = focusedIndex;
    if (e.key === "ArrowRight") {
      nextIndex = focusedIndex + 1;
    } else if (e.key === "ArrowLeft") {
      nextIndex = focusedIndex - 1;
    } else if (e.key === "ArrowDown") {
      nextIndex = focusedIndex + cols;
    } else if (e.key === "ArrowUp") {
      nextIndex = focusedIndex - cols;
    } else {
      return;
    }

    if (nextIndex >= 0 && nextIndex < visibleList.length) {
      e.preventDefault();
      setFocusedIndex(nextIndex);
      // Wait for React to re-render with the new tabIndex
      setTimeout(() => {
        const cards = containerRef.current?.querySelectorAll('.note-card');
        if (cards && cards[nextIndex]) {
          (cards[nextIndex] as HTMLElement).focus();
        }
      }, 0);
    }
  };

  const renderCards = (list: Note[]) =>
    list.map((note) => {
      const isFocused = visibleList[focusedIndex]?.id === note.id;
      return (
        <NoteCard
          key={note.id}
          note={note}
          selected={selectedSet.has(note.id)}
          orderedIds={orderedIds}
          query={query}
          tabIndex={isFocused ? 0 : -1}
          onFocus={() => {
            const idx = visibleList.findIndex((n) => n.id === note.id);
            if (idx !== -1 && idx !== focusedIndex) setFocusedIndex(idx);
          }}
        />
      );
    });`
);

code = code.replace(
  'return (\n    <div className="notes-list">',
  'return (\n    <div className="notes-list" ref={containerRef} onKeyDown={handleKeyDown}>'
);

fs.writeFileSync('src/components/NotesGrid.tsx', code);
