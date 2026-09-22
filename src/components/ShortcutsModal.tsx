import { Keyboard, X } from "lucide-react";
import { useUiStore } from "../store/uiStore";

const SHORTCUT_GROUPS = [
  {
    title: "General",
    items: [
      { key: "Ctrl + N", desc: "Create new note" },
      { key: "Ctrl + K", desc: "Search notes" },
      { key: "Esc", desc: "Close editor / clear selection" },
      { key: "? or Ctrl + /", desc: "Show keyboard shortcuts" },
    ],
  },
  {
    title: "Editor",
    items: [
      { key: "Ctrl + S", desc: "Force save note" },
      { key: "Ctrl + Shift + P", desc: "Pin / unpin note" },
      { key: "Ctrl + Shift + F", desc: "Star / favorite note" },
    ],
  },
  {
    title: "Actions & Selection",
    items: [
      { key: "Ctrl + A", desc: "Select all notes" },
      { key: "Ctrl + Z", desc: "Undo last action" },
      { key: "Delete", desc: "Move selected note(s) to trash" },
      { key: "Space / Enter", desc: "Select / open focused note" },
    ],
  },
];

export function ShortcutsModal() {
  const shortcutsOpen = useUiStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  if (!shortcutsOpen) return null;

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClick={() => setShortcutsOpen(false)}
    >
      <div className="dialog shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <div className="shortcuts-header-left">
            <Keyboard size={18} className="theme-accent-color" />
            <h2 id="shortcuts-title" className="dialog-title">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Close shortcuts"
            onClick={() => setShortcutsOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <div className="shortcuts-content">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <h3>{group.title}</h3>
              <div className="shortcuts-items">
                {group.items.map((item) => (
                  <div key={item.key} className="shortcuts-row">
                    <span className="shortcuts-desc">{item.desc}</span>
                    <kbd className="kbd shortcuts-kbd">{item.key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
