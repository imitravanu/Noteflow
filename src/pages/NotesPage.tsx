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
          icon={<SearchX size={28} strokeWidth={1.5} />}
          title={`No results for “${query}”`}
          message="Check the spelling or try a different search."
        />
      );
    }
    switch (view) {
      case "all":
        return (
          <EmptyState
            icon={<StickyNote size={28} strokeWidth={1.5} />}
            title="No notes yet"
            message="Create your first note to get started."
            action={{ label: "New note", onClick: () => void createNote() }}
          />
        );
      case "pinned":
        return (
          <EmptyState
            icon={<Pin size={28} strokeWidth={1.5} />}
            title="No pinned notes"
            message="Pin important notes to keep them at the top."
          />
        );
      case "favorites":
        return (
          <EmptyState
            icon={<Star size={28} strokeWidth={1.5} />}
            title="No favorite notes"
            message="Star notes you want to find quickly."
          />
        );
      case "archive":
        return (
          <EmptyState
            icon={<Archive size={28} strokeWidth={1.5} />}
            title="No archived notes"
            message="Archived notes are kept out of your main list."
          />
        );
      case "trash":
        return (
          <EmptyState
            icon={<Trash2 size={28} strokeWidth={1.5} />}
            title="Trash is empty"
            message="Deleted notes appear here before final removal."
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
        <div className="grid-empty" aria-busy="true">Loading…</div>
      ) : emptyState ?? (
        <NotesGrid notes={notes} showPinnedSection={view === "all" && !query && !activeTagId} />
      )}

      <SelectionBar />
      <NoteEditor />
    </div>
  );
}

