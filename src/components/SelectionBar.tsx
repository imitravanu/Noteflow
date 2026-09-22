import { useState } from "react";
import { Archive, Pin, Star, Tag, Trash2, Undo2, X } from "lucide-react";
import { api } from "../services/api";
import { useNotesStore } from "../store/notesStore";
import { errText, useUiStore } from "../store/uiStore";
import { TagPicker } from "./TagPicker";

export function SelectionBar() {
  const selection = useUiStore((s) => s.selection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const notes = useNotesStore((s) => s.notes);
  const setFlagsForSelection = useNotesStore((s) => s.setFlagsForSelection);
  const trashSelection = useNotesStore((s) => s.trashSelection);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const view = useUiStore((s) => s.view);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const restoreNotes = useNotesStore((s) => s.restoreNotes);
  const deletePermanent = useNotesStore((s) => s.deletePermanent);

  if (selection.length === 0) return null;

  if (view === "trash") {
    return (
      <div className="selection-bar" role="toolbar" aria-label="Actions for selected notes">
        <span className="selection-count">
          {selection.length === 1 ? "1 note selected" : `${selection.length} notes selected`}
        </span>
        <div className="selection-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void restoreNotes([...selection]);
              clearSelection();
            }}
          >
            <Undo2 size={15} aria-hidden="true" /> Restore
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm danger"
            onClick={() =>
              askConfirm({
                title: "Delete forever?",
                message:
                  selection.length === 1
                    ? "This note will be permanently deleted. This cannot be undone."
                    : `All ${selection.length} selected notes will be permanently deleted. This cannot be undone.`,
                confirmLabel: "Delete forever",
                danger: true,
                onConfirm: () => {
                  void deletePermanent([...selection]);
                  clearSelection();
                },
              })
            }
          >
            <Trash2 size={15} aria-hidden="true" /> Delete forever
          </button>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          onClick={clearSelection}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  const selectedNotes = notes.filter((n) => selection.includes(n.id));
  const allPinned = selectedNotes.length > 0 && selectedNotes.every((n) => n.pinned);
  const allFavorites = selectedNotes.length > 0 && selectedNotes.every((n) => n.favorite);
  const allArchived = selectedNotes.length > 0 && selectedNotes.every((n) => n.archived);

  const appliedTagIds = new Set(
    selectedNotes[0]?.tags.map((t) => t.id).filter((id) =>
      selectedNotes.every((n) => n.tags.some((t) => t.id === id)),
    ) ?? [],
  );

  return (
    <div className="selection-bar" role="toolbar" aria-label="Actions for selected notes">
      <span className="selection-count">
        {selection.length === 1 ? "1 note selected" : `${selection.length} notes selected`}
      </span>
      <div className="selection-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void setFlagsForSelection({ pinned: !allPinned })}
        >
          <Pin size={15} aria-hidden="true" />
          {allPinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void setFlagsForSelection({ favorite: !allFavorites })}
        >
          <Star size={15} aria-hidden="true" />
          {allFavorites ? "Unfavorite" : "Favorite"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void setFlagsForSelection({ archived: !allArchived })}
        >
          <Archive size={15} aria-hidden="true" />
          {allArchived ? "Unarchive" : "Archive"}
        </button>
        <div className="selection-tag-wrap">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={tagPickerOpen}
            onClick={() => setTagPickerOpen((v) => !v)}
          >
            <Tag size={15} aria-hidden="true" /> Tag
          </button>
          {tagPickerOpen && (
            <TagPicker
              appliedTagIds={appliedTagIds}
              onToggle={(tag, apply) => applyTagToSelection(tag.id, apply)}
              onClose={() => setTagPickerOpen(false)}
            />
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm danger"
          onClick={() => void trashSelection()}
        >
          <Trash2 size={15} aria-hidden="true" /> Delete
        </button>
      </div>
      <button
        type="button"
        className="icon-btn icon-btn-sm"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        onClick={clearSelection}
      >
        <X size={14} />
      </button>
    </div>
  );

  async function applyTagToSelection(tagId: string, apply: boolean) {
    try {
      await api.setTagsBulk([...selection], tagId, apply);
      useUiStore.getState().clearSelection();
      await useNotesStore.getState().refresh();
    } catch (e) {
      useUiStore.getState().showSnackbar(errText(e));
    }
  }
}

