import { useEffect } from "react";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";
import { escapeAction } from "../utils/escape";

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
        if (ui.editorNoteId) return; // never pull focus behind the editor overlay
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

      if (mod && (key === "\\" || key === "b")) {
        e.preventDefault();
        // Ctrl+B is "bold" muscle memory while typing, and the sidebar sits
        // invisible behind the editor overlay — don't move it from inside.
        if (!ui.editorNoteId) ui.setSidebarOpen(!ui.sidebarOpen);
        return;
      }

      if ((e.key === "?" && !editable) || (mod && e.key === "/")) {
        e.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }

      if (e.key === "Escape") {
        // Unwind exactly one layer; the decision is a pure, unit-tested
        // function (utils/escape.test.ts) so popover → editor priority
        // can't silently regress.
        const action = escapeAction({
          confirmOpen: ui.confirm !== null,
          shortcutsOpen: ui.shortcutsOpen,
          popoverOpen: ui.openPopover !== null,
          editorOpen: ui.editorNoteId !== null,
          hasSelection: ui.selection.length > 0,
          sidebarOpen: ui.sidebarOpen,
        });
        switch (action) {
          case "close-shortcuts":
            ui.setShortcutsOpen(false);
            return;
          case "close-popover":
            ui.openPopover?.close();
            return;
          case "close-editor":
            void ui.flushAndCloseEditor();
            return;
          case "clear-selection":
            ui.clearSelection();
            return;
          case "close-sidebar":
            ui.setSidebarOpen(false);
            return;
          case "none":
            return;
        }
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

