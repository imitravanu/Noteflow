const fs = require('fs');
let code = fs.readFileSync('src/pages/NotesPage.tsx', 'utf-8');

code = code.replace(
  'import { NotesGrid } from "../components/NotesGrid";',
  'import { NotesGrid } from "../components/NotesGrid";\nimport { SkeletonCard } from "../components/SkeletonCard";\nimport { SEARCH_DEBOUNCE_MS } from "../constants";'
);

code = code.replace(
  'const delay = query ? 150 : 0;',
  'const delay = query ? SEARCH_DEBOUNCE_MS : 0;'
);

code = code.replace(
  '<p>{subtitle}</p>',
  '<p aria-live="polite">{subtitle}</p>'
);

// When loading is true and notes is empty, render 8 SkeletonCards.
// The NotesGrid component currently renders empty state. But in NotesPage it renders:
// {emptyState ?? (
//   <NotesGrid notes={notes} showPinnedSection={view === "all" && !query && !activeTagId} />
// )}
code = code.replace(
  '{emptyState ?? (',
  `{loading && notes.length === 0 ? (
        <div className="notes-list">
          <section>
            <div className="notes-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </section>
        </div>
      ) : emptyState ?? (`
);

fs.writeFileSync('src/pages/NotesPage.tsx', code);
