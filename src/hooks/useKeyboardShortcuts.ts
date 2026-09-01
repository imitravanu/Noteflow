import { useEffect } from "react";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";

function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

/**
 * Global keyboard map:
 *   Ctrl+N new note · Ctrl+K search · Ctrl+S force save
 *   Ctrl+Shift+P pin · Ctrl+Shift+F favorite
 *   Ctrl+A select all · Ctrl+Z undo action · Delete trash selection
 *   Escape close editor/dialog/clear selection
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const notes = useNotesStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const editable = isEditableTarget(e);

      if (mod && !e.shiftKey && key === "n") {
        e.preventDefault();
        void notes.createNote();
        return;
      }

      if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        const input = document.getElementById("global-search") as HTMLInputElement | null;
        input?.focus();
        input?.select();
        return;
      }

      if (mod && !e.shiftKey && key === "s") {
        e.preventDefault();
        void ui.flushEditor();
        return;
      }

      if (mod && e.shiftKey && key === "p") {
        e.preventDefault();
        const target = ui.editorNote ?? notes.notes.find((n) => n.id === ui.selection[0]);
        if (target) void notes.setFlags(target.id, { pinned: !target.pinned });
        return;
      }

      if (mod && e.shiftKey && key === "f") {
        e.preventDefault();
        const target = ui.editorNote ?? notes.notes.find((n) => n.id === ui.selection[0]);
        if (target) void notes.setFlags(target.id, { favorite: !target.favorite });
        return;
      }

      if (mod && !e.shiftKey && key === "a" && !editable && !ui.editorNoteId) {
        e.preventDefault();
        ui.selectAll(notes.notes.map((n) => n.id));
        return;
      }

      if (mod && !e.shiftKey && key === "z" && !editable) {
        e.preventDefault();
        void ui.undo();
        return;
      }

      if ((e.key === "?" && !editable) || (mod && e.key === "/")) {
        e.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }

      if (e.key === "Escape") {
        if (ui.confirm) return; // dialog manages its own escape handling
        if (ui.shortcutsOpen) {
          ui.setShortcutsOpen(false);
          return;
        }
        if (ui.editorNoteId) {
          void ui.flushAndCloseEditor();
          return;
        }
        if (ui.selection.length) {
          ui.clearSelection();
          return;
        }
        if (ui.sidebarOpen) ui.setSidebarOpen(false);
        return;
      }

      if (
        e.key === "Delete" && !editable && !ui.editorNoteId && ui.selection.length &&
        ui.view !== "trash"
      ) {
        e.preventDefault();
        void notes.trashSelection();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

