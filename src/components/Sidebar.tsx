import { useState } from "react";
import {
  Archive,
  Hash,
  Pin,
  Plus,
  Settings,
  Star,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import type { NoteView } from "../types";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";

const NAV_ITEMS: { view: NoteView; label: string; icon: typeof StickyNote }[] = [
  { view: "all", label: "All Notes", icon: StickyNote },
  { view: "pinned", label: "Pinned", icon: Pin },
  { view: "favorites", label: "Favorites", icon: Star },
  { view: "archive", label: "Archive", icon: Archive },
  { view: "trash", label: "Trash", icon: Trash2 },
];

export function Sidebar() {
  const view = useUiStore((s) => s.view);
  const activeTagId = useUiStore((s) => s.activeTagId);
  const setView = useUiStore((s) => s.setView);
  const setActiveTag = useUiStore((s) => s.setActiveTag);
  const setPage = useUiStore((s) => s.setPage);
  const flushAndCloseEditor = useUiStore((s) => s.flushAndCloseEditor);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const counts = useNotesStore((s) => s.counts);
  const tags = useNotesStore((s) => s.tags);
  const deleteTag = useNotesStore((s) => s.deleteTag);
  const createTag = useNotesStore((s) => s.createTag);

  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const navigate = (fn: () => void) => {
    void flushAndCloseEditor().finally(() => {
      fn();
      setSidebarOpen(false);
    });
  };

  const submitNewTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    setNewTagName("");
    setAddingTag(false);
    await createTag(name);
  };

  return (
    <>
      {sidebarOpen && (
        <div
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className="sidebar" data-open={sidebarOpen || undefined} aria-label="Main navigation">
        <nav className="sidebar-nav" aria-label="Note views">
          {NAV_ITEMS.map(({ view: v, label, icon: Icon }) => {
            const count =
              v === "all" ? counts.all
              : v === "pinned" ? counts.pinned
              : v === "favorites" ? counts.favorites
              : v === "archive" ? counts.archived
              : counts.trash;
            return (
              <button
                key={v}
                type="button"
                className={`sidebar-item${view === v && !activeTagId ? " active" : ""}`}
                aria-current={view === v && !activeTagId ? "page" : undefined}
                onClick={() => navigate(() => setView(v))}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="sidebar-item-label">{label}</span>
                {count > 0 && <span className="sidebar-count">{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span>Tags</span>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label="Add tag"
              title="Add tag"
              onClick={() => setAddingTag(true)}
            >
              <Plus size={14} />
            </button>
          </div>

          {addingTag && (
            <div className="sidebar-tag-add">
              <Hash size={13} aria-hidden="true" />
              <input
                autoFocus
                value={newTagName}
                placeholder="Tag name"
                aria-label="New tag name"
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitNewTag();
                  if (e.key === "Escape") {
                    setAddingTag(false);
                    setNewTagName("");
                  }
                }}
                onBlur={() => {
                  if (newTagName.trim()) void submitNewTag();
                  else setAddingTag(false);
                }}
              />
            </div>
          )}

          <div className="sidebar-tags" role="list">
            {tags.length === 0 && !addingTag && (
              <p className="sidebar-tags-empty">No tags yet</p>
            )}
            {tags.map((tag) => (
              <div
                key={tag.id}
                role="listitem"
                className={`sidebar-item tag-item${activeTagId === tag.id ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="sidebar-tag-button"
                  onClick={() => navigate(() => setActiveTag(tag.id))}
                  aria-current={activeTagId === tag.id ? "page" : undefined}
                >
                  <Hash size={15} aria-hidden="true" />
                  <span className="sidebar-item-label">{tag.name}</span>
                  {tag.noteCount ? (
                    <span className="sidebar-count">{tag.noteCount}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm tag-delete"
                  aria-label={`Delete tag ${tag.name}`}
                  title="Delete tag"
                  onClick={() =>
                    askConfirm({
                      title: "Delete tag?",
                      message: `“${tag.name}” will be removed from all notes. The notes themselves are not deleted.`,
                      confirmLabel: "Delete tag",
                      danger: true,
                      onConfirm: () => deleteTag(tag.id),
                    })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-item"
            onClick={() => navigate(() => setPage("settings"))}
          >
            <Settings size={16} aria-hidden="true" />
            <span className="sidebar-item-label">Settings</span>
          </button>
        </div>
      </aside>
    </>
  );
}

