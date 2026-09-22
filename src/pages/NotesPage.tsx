import { useEffect, useRef } from "react";
import { Pin, Plus, Star, StickyNote, Trash2, Archive, SearchX } from "lucide-react";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";
import { EmptyState } from "../components/EmptyState";
import { NoteEditor } from "../components/NoteEditor";
import { NotesGrid } from "../components/NotesGrid";
import { SelectionBar } from "../components/SelectionBar";

const VIEW_TITLES: Record<string, string> = {
  all: "All Notes",
  pinned: "Pinned",
  favorites: "Favorites",
  archive: "Archive",
  trash: "Trash",
};

export function NotesPage() {
  const view = useUiStore((s) => s.view);
  const query = useUiStore((s) => s.query);
  const setQuery = useUiStore((s) => s.setQuery);
  const activeTagId = useUiStore((s) => s.activeTagId);
  const askConfirm = useUiStore((s) => s.askConfirm);

  const notes = useNotesStore((s) => s.notes);
  const tags = useNotesStore((s) => s.tags);
  const loading = useNotesStore((s) => s.loading);
  const refresh = useNotesStore((s) => s.refresh);
  const createNote = useNotesStore((s) => s.createNote);
  const emptyTrash = useNotesStore((s) => s.emptyTrash);

  // Reload whenever the view, tag filter, or (debounced) search query changes.
  // The initial load is handled by useAppInit, so skip the first run to avoid
  // fetching the list twice on startup.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const delay = query ? 150 : 0;
    const t = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(t);
  }, [view, query, activeTagId, refresh]);

  const activeTag = tags.find((t) => t.id === activeTagId);
  const headerTitle = activeTag ? `#${activeTag.name}` : VIEW_TITLES[view];
  const subtitle = query
    ? notes.length === 1
      ? "1 result"
      : `${notes.length} results`
    : notes.length === 1
      ? "1 note"
      : `${notes.length} notes`;

  const emptyState = (() => {
    if (loading || notes.length > 0) return null;
    if (query) {
      return (
        <EmptyState
          icon={<SearchX size={32} strokeWidth={1.4} />}
          title="No matches found"
          message={`Nothing matched “${query}”. Try a different search.`}
          action={{ label: "Clear search", onClick: () => setQuery("") }}
        />
      );
    }
    switch (view) {
      case "all":
        return (
          <EmptyState
            icon={<StickyNote size={32} strokeWidth={1.4} />}
            title="Your workspace awaits"
            message="Create your first note and start capturing ideas."
            action={{ label: "Create Note", onClick: () => void createNote() }}
          />
        );
      case "pinned":
        return (
          <EmptyState
            icon={<Pin size={32} strokeWidth={1.4} />}
            title="Nothing pinned yet"
            message="Pin your most important notes to keep them front and center."
          />
        );
      case "favorites":
        return (
          <EmptyState
            icon={<Star size={32} strokeWidth={1.4} />}
            title="No favorites yet"
            message="Star the notes you reach for most — they'll appear here."
          />
        );
      case "archive":
        return (
          <EmptyState
            icon={<Archive size={32} strokeWidth={1.4} />}
            title="Archive is clear"
            message="Notes you archive are tucked away but never deleted."
          />
        );
      case "trash":
        return (
          <EmptyState
            icon={<Trash2 size={32} strokeWidth={1.4} />}
            title="Trash is empty"
            message="Deleted notes rest here before permanent removal."
          />
        );
    }
    return null;
  })();

  return (
    <div className="notes-page">
      <header className="page-header">
        <div className="page-header-titles">
          <h1>{headerTitle}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="page-header-actions">
          {view === "trash" && notes.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost danger"
              onClick={() =>
                askConfirm({
                  title: "Empty trash?",
                  message: `All ${notes.length} note${notes.length === 1 ? "" : "s"} in Trash will be permanently deleted. This cannot be undone.`,
                  confirmLabel: "Empty trash",
                  danger: true,
                  onConfirm: () => emptyTrash(),
                })
              }
            >
              <Trash2 size={15} aria-hidden="true" /> Empty Trash
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void createNote()}
          >
            <Plus size={16} aria-hidden="true" /> New Note
          </button>
        </div>
      </header>

      {loading ? (
        // Skeleton mirrors the real grid so the first notes land without a
        // layout jump. (The old bare "Loading…" node was `display: none`, so
        // users actually got a blank flash — this is visible by construction.)
        <div className="notes-grid grid-skeleton" role="status" aria-busy="true">
          <span className="sr-only">Loading notes…</span>
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="skeleton-card"
              style={{ animationDelay: `${i * 60}ms` }}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : emptyState ?? (
        <NotesGrid notes={notes} showPinnedSection={view === "all" && !query && !activeTagId} />
      )}

      <SelectionBar />
      <NoteEditor />
    </div>
  );
}

