const fs = require('fs');
let code = fs.readFileSync('src/components/TopBar.tsx', 'utf-8');

if (!code.includes('SortOrder')) {
  code = code.replace(
    'import { Keyboard, Menu, Monitor, Moon, Search, Settings, Sun, X } from "lucide-react";',
    'import { Keyboard, Menu, Monitor, Moon, Search, Settings, Sun, X } from "lucide-react";\nimport type { SortOrder } from "../types";'
  );
}

code = code.replace(
  'const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);',
  'const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);\n  const sort = useUiStore((s) => s.sort);\n  const setSort = useUiStore((s) => s.setSort);'
);

code = code.replace(
  '          onKeyDown={(e) => {\n            if (e.key === "Escape") {\n              e.stopPropagation();\n              setQuery("");\n              e.currentTarget.blur();\n            }\n          }}',
  `          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setQuery("");
              e.currentTarget.blur();
              const firstCard = document.querySelector('.note-card') as HTMLElement;
              if (firstCard) firstCard.focus();
            }
          }}`
);

const selectHTML = `
        <select
          className="topbar-sort-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOrder)}
          aria-label="Sort notes"
        >
          <option value="updated_desc">Date Modified ↓</option>
          <option value="updated_asc">Date Modified ↑</option>
          <option value="created_desc">Date Created ↓</option>
          <option value="created_asc">Date Created ↑</option>
          <option value="title_asc">Title A-Z</option>
          <option value="title_desc">Title Z-A</option>
        </select>`;

code = code.replace(
  '<div className="topbar-actions">',
  '<div className="topbar-actions">' + selectHTML
);

fs.writeFileSync('src/components/TopBar.tsx', code);
