import {
  Archive,
  ArchiveRestore,
  Check,
  Circle,
  ListChecks,
  Pin,
  PinOff,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Note } from "../types";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";
import { formatRelativeTime } from "../utils/format";
import { bodyPreview } from "../utils/highlight";
import { Highlighted } from "./Highlighted";

interface NoteCardProps {
  note: Note;
  selected: boolean;
  orderedIds: string[];
  query: string;
}

export function NoteCard({ note, selected, orderedIds, query }: NoteCardProps) {
  const toggleSelect = useUiStore((s) => s.toggleSelect);
  const openEditor = useUiStore((s) => s.openEditor);
  const selectionLength = useUiStore((s) => s.selection.length);
  const view = useUiStore((s) => s.view);
  const setFlags = useNotesStore((s) => s.setFlags);
  const restoreNotes = useNotesStore((s) => s.restoreNotes);

  const preview = bodyPreview(note.content);
  const doneCount = note.checklist.filter((c) => c.checked).length;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <article
      className={`note-card color-${note.color}${selected ? " selected" : ""}`}
      data-selected={selected || undefined}
      tabIndex={0}
      role="button"
      aria-label={`Note: ${note.title || "Untitled"}`}
      onClick={(e) => {
        if (view === "trash") {
          // Deleted notes are selected for restore/permanent delete, not edited.
          e.preventDefault();
          toggleSelect(note.id, { ctrl: true, shift: e.shiftKey }, orderedIds);
        } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          toggleSelect(note.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, orderedIds);
        } else if (selectionLength > 0) {
          // In selection mode a plain click re-targets the selection instead of
          // opening the editor — otherwise users get trapped until Esc.
          e.preventDefault();
          toggleSelect(note.id, { ctrl: true, shift: false }, orderedIds);
        } else {
          openEditor(note.id);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          if (view !== "trash") openEditor(note.id);
        }
        if (e.key === " ") {
          e.preventDefault();
          toggleSelect(note.id, { ctrl: true, shift: false }, orderedIds);
        }
      }}
    >
      <button
        type="button"
        className="note-card-check"
        aria-label={selected ? "Deselect note" : "Select note"}
        aria-pressed={selected}
        title={selected ? "Deselect" : "Select"}
        onClick={(e) => {
          stop(e);
          toggleSelect(note.id, { ctrl: true, shift: false }, orderedIds);
        }}
      >
        {selected ? <Check size={13} /> : <Circle size={13} />}
      </button>

      <div className="note-card-actions" onClick={stop}>
        {view === "trash" ? (
          <>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label="Restore note"
              title="Restore"
              onClick={() => void restoreNotes([note.id])}
            >
              <Undo2 size={14} />
            </button>
            <TrashActions noteId={note.id} single />
          </>
        ) : (
          <>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label={note.pinned ? "Unpin note" : "Pin note"}
              aria-pressed={note.pinned}
              title={note.pinned ? "Unpin" : "Pin"}
              onClick={() => void setFlags(note.id, { pinned: !note.pinned })}
            >
              {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label={note.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={note.favorite}
              title={note.favorite ? "Unfavorite" : "Favorite"}
              onClick={() => void setFlags(note.id, { favorite: !note.favorite })}
            >
              <Star size={14} className={note.favorite ? "starred" : undefined} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label={note.archived ? "Unarchive note" : "Archive note"}
              title={note.archived ? "Unarchive" : "Archive"}
              onClick={() => void setFlags(note.id, { archived: !note.archived })}
            >
              {note.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            </button>
            <TrashActions noteId={note.id} single />
          </>
        )}
      </div>

      {note.title ? (
        <h3 className="note-card-title">
          <Highlighted text={note.title} query={query} />
        </h3>
      ) : (
        <h3 className="note-card-title note-card-title-untitled">Untitled</h3>
      )}

      {preview && (
        <p className="note-card-preview">
          <Highlighted text={preview} query={query} />
        </p>
      )}

      {note.checklist.length > 0 && (
        <p className="note-card-checklist">
          <ListChecks size={13} aria-hidden="true" />
          {doneCount}/{note.checklist.length}
        </p>
      )}

      {note.tags.length > 0 && (
        <div className="note-card-tags">
          {note.tags.slice(0, 4).map((tag) => (
            <span key={tag.id} className="chip">
              <Highlighted text={tag.name} query={query} />
            </span>
          ))}
          {note.tags.length > 4 && (
            <span className="chip chip-more">+{note.tags.length - 4}</span>
          )}
        </div>
      )}

      <footer className="note-card-footer">
        <span className="note-card-flags">
          {note.pinned && (
            <span title="Pinned">
              <Pin size={12} aria-hidden="true" className="flag-pinned" />
            </span>
          )}
          {note.favorite && (
            <span title="Favorite">
              <Star size={12} aria-hidden="true" className="flag-starred" />
            </span>
          )}
          {note.archived && (
            <span title="Archived">
              <Archive size={12} aria-hidden="true" className="flag-archived" />
            </span>
          )}
        </span>
        <time
          className="note-card-time"
          dateTime={(() => {
            const t = view === "trash" ? (note.deletedAt ?? note.updatedAt) : note.updatedAt;
            return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : new Date().toISOString();
          })()}
        >
          {formatRelativeTime(
            view === "trash" ? (note.deletedAt ?? note.updatedAt) : note.updatedAt,
          )}
        </time>
      </footer>
    </article>
  );
}

/** Trash button; permanent deletion is gated behind a confirm dialog. */
function TrashActions({ noteId, single }: { noteId: string; single?: boolean }) {
  const askConfirm = useUiStore((s) => s.askConfirm);
  const trashNotes = useNotesStore((s) => s.trashNotes);
  const deletePermanent = useNotesStore((s) => s.deletePermanent);
  const view = useUiStore((s) => s.view);

  if (view === "trash") {
    return (
      <button
        type="button"
        className="icon-btn icon-btn-sm danger-hover"
        aria-label="Delete permanently"
        title="Delete permanently"
        onClick={() =>
          askConfirm({
            title: "Delete forever?",
            message: "This note will be permanently deleted. This cannot be undone.",
            confirmLabel: "Delete forever",
            danger: true,
            onConfirm: () => deletePermanent([noteId]),
          })
        }
      >
        <Trash2 size={14} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="icon-btn icon-btn-sm danger-hover"
      aria-label="Move note to trash"
      title={single ? "Move to trash" : "Trash"}
      onClick={() => void trashNotes([noteId])}
    >
      <Trash2 size={14} />
    </button>
  );
}

