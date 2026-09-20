import {
  Keyboard,
  Monitor,
  Moon,
  PanelLeft,
  Search,
  Settings,
  SquarePen,
  Sun,
  X,
} from "lucide-react";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";
import { Logo } from "./Logo";

export function TopBar() {
  const query = useUiStore((s) => s.query);
  const setQuery = useUiStore((s) => s.setQuery);
  const theme = useUiStore((s) => s.theme);
  const cycleTheme = useUiStore((s) => s.cycleTheme);
  const setPage = useUiStore((s) => s.setPage);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const page = useUiStore((s) => s.page);
  const createNote = useNotesStore((s) => s.createNote);

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel =
    theme === "light" ? "Light theme" : theme === "dark" ? "Dark theme" : "Follow system theme";

  return (
    <header className="topbar">
      {/* Left: Sidebar Panel Toggle + Brand */}
      <div className="topbar-left">
        <button
          type="button"
          className={`icon-btn topbar-sidebar-btn${sidebarOpen ? " active" : ""}`}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? "Hide sidebar (Ctrl+\\)" : "Show sidebar (Ctrl+\\)"}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <PanelLeft size={17} />
        </button>

        <div
          className="topbar-brand"
          onClick={() => setPage("notes")}
          role="button"
          tabIndex={0}
          title="NoteFlow Notes"
        >
          <Logo size={26} />
          <div className="topbar-title-wrap">
            <span className="topbar-title">NoteFlow</span>
            <span className="topbar-version-pill">v1.2.0</span>
          </div>
        </div>
      </div>

      {/* Center: Command / Search Bar */}
      <div className="topbar-search">
        <Search size={14} className="topbar-search-icon" aria-hidden="true" />
        <input
          id="global-search"
          type="search"
          value={query}
          placeholder="Search notes, tags, checklists…"
          aria-label="Search notes"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setQuery("");
              e.currentTarget.blur();
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-btn icon-btn-sm topbar-clear-search"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Right: New Note Quick Compose + Segmented Control Pill */}
      <div className="topbar-right">
        <button
          type="button"
          className="topbar-compose-btn"
          aria-label="Create note (Ctrl+N)"
          title="Create note (Ctrl+N)"
          onClick={() => void createNote()}
        >
          <SquarePen size={14} />
          <span>New Note</span>
        </button>

        <div className="topbar-utility-pill" role="toolbar" aria-label="Quick tools">
          <button
            type="button"
            className="icon-btn"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={15} />
          </button>
          <span className="topbar-utility-sep" aria-hidden="true" />
          <button
            type="button"
            className="icon-btn"
            aria-label={themeLabel}
            title={`${themeLabel} — click to switch`}
            onClick={cycleTheme}
          >
            <ThemeIcon size={15} />
          </button>
          <span className="topbar-utility-sep" aria-hidden="true" />
          <button
            type="button"
            className={`icon-btn${page === "settings" ? " active" : ""}`}
            aria-label="Settings"
            title="Settings"
            onClick={() => setPage(page === "settings" ? "notes" : "settings")}
          >
            <Settings size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}


