import { Keyboard, Menu, Monitor, Moon, Search, Settings, Sun, X } from "lucide-react";
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

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel =
    theme === "light" ? "Light theme" : theme === "dark" ? "Dark theme" : "Follow system theme";

  return (
    <header className="topbar">
      <button
        type="button"
        className={`icon-btn sidebar-toggle${sidebarOpen ? " active" : ""}`}
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
        title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <Menu size={18} />
      </button>

      <div className="topbar-brand">
        <Logo />
        <span className="topbar-title">NoteFlow</span>
      </div>

      <div className="topbar-search">
        <Search size={15} className="topbar-search-icon" aria-hidden="true" />
        <input
          id="global-search"
          type="search"
          value={query}
          placeholder="Search notes…"
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
        {query ? (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="kbd">Ctrl K</kbd>
        )}
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={themeLabel}
          title={`${themeLabel} — click to switch`}
          onClick={cycleTheme}
        >
          <ThemeIcon size={18} />
        </button>
        <button
          type="button"
          className={`icon-btn${page === "settings" ? " active" : ""}`}
          aria-label="Settings"
          title="Settings"
          onClick={() => setPage(page === "settings" ? "notes" : "settings")}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}


