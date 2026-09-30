import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Check,
  Clock,
  Download,
  Hash,
  Palette,
  Pin,
  Plus,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { ChecklistItem, FlagPatch, Note, NoteColor, SaveStatus } from "../types";
import { api } from "../services/api";
import { useNotesStore } from "../store/notesStore";
import { errText, useUiStore } from "../store/uiStore";
import {
  countWordsAndChars,
  formatDateTime,
  formatRelativeTime,
  noteToMarkdown,
} from "../utils/format";
import { createSaveGate, type SaveGate } from "../utils/saveGate";
import { formatReminderTime } from "../utils/reminder";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ColorPicker } from "./ColorPicker";
import { ReminderPicker } from "./ReminderPicker";
import { TagPicker } from "./TagPicker";

interface Draft {
  title: string;
  content: string;
  checklist: ChecklistItem[];
  color: NoteColor;
}

/** crypto.randomUUID fallback for webview origins without a secure context. */
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function NoteEditor() {
  const noteId = useUiStore((s) => s.editorNoteId);
  const setEditorNote = useUiStore((s) => s.setEditorNote);
  const registerEditorFlush = useUiStore((s) => s.registerEditorFlush);
  const flushAndCloseEditor = useUiStore((s) => s.flushAndCloseEditor);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const showSnackbar = useUiStore((s) => s.showSnackbar);
  const setFlags = useNotesStore((s) => s.setFlags);
  const setReminder = useNotesStore((s) => s.setReminder);
  const trashNotes = useNotesStore((s) => s.trashNotes);
  const createTag = useNotesStore((s) => s.createTag);

  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft>({
    title: "",
    content: "",
    checklist: [],
    color: "default",
  });
  const [status, setStatus] = useState<SaveStatus>("saved");
  // Close animation: when the store id clears, the last committed note +
  // draft stay on screen for one exit cycle (`exitingId`), then unmount.
  const [exitingId, setExitingId] = useState<string | null>(null);
  // Note-switch animation: the outgoing note ghosts under the incoming
  // panel's entrance (a real crossfade instead of a content pop).
  const [swapId, setSwapId] = useState<string | null>(null);
  const swapSnapRef = useRef<{ note: Note; draft: Draft } | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [inlineTagPickerOpen, setInlineTagPickerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false);

  const draftRef = useRef(draft);
  const noteRef = useRef(note);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Mirror the latest values into refs *after commit* (layout effects run
  // synchronously post-commit, before paint or any event/timer can observe
  // them), instead of during render where a discarded concurrent render
  // could leave a ref pointing at data React never committed.
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useLayoutEffect(() => {
    noteRef.current = note;
  }, [note]);

  // A reminder can fire while its own note is open: the backend clears the time
  // and the app refreshes the list, so mirror just that one field into the local
  // snapshot. Everything else stays owned by the editor, which is what protects
  // in-progress edits; and a note that is not in the current list is left alone
  // (the entry would otherwise read as "no reminder" and blank the badge).
  const storeEntry = useNotesStore((s) => s.notes.find((n) => n.id === noteId));
  useEffect(() => {
    if (!storeEntry) return;
    setNote((prev) =>
      prev && prev.reminderAt !== storeEntry.reminderAt
        ? { ...prev, reminderAt: storeEntry.reminderAt }
        : prev,
    );
  }, [storeEntry]);

  // Save gate: owns debounce / in-flight chaining / retry backoff so races
  // are unit-tested in utils/saveGate.ts instead of living in this component.
  // Created once; the save callback only closes over stable refs and setters.
  const gateRef = useRef<SaveGate | null>(null);
  if (!gateRef.current) {
    gateRef.current = createSaveGate({
      save: async () => {
        const targetId = noteRef.current?.id;
        if (!targetId) return true; // nothing loaded yet — nothing to write
        // Capture the draft at call time so a note switch mid-save can't
        // redirect this payload to the wrong note.
        const d = draftRef.current;
        const updated = await useNotesStore.getState().updateNote(targetId, {
          title: d.title,
          content: d.content,
          checklist: d.checklist,
          color: d.color,
        });
        if (!updated) return false;
        // The editor may have switched notes while this save was running
        // (openEditor flushes, but defense-in-depth): only merge results
        // back while this note is still the editor's subject.
        if (noteRef.current?.id !== targetId) return true;
        setNote((prev) => (prev ? { ...prev, ...updated } : updated));
        setEditorNote(updated);
        return true;
      },
      onStatus: setStatus,
    });
  }
  const gate = gateRef.current;
  const [newItemText, setNewItemText] = useState("");
  const newItemInputRef = useRef<HTMLInputElement>(null);

  // ---- load ---------------------------------------------------------------
  // Layout effect so a note *switch* paints the new content on the first
  // frame of the entrance animation (the remount is keyed on the id): with
  // a passive effect the panel would replay its enter showing the previous
  // note's text for a frame before swapping.
  const lastLoadedIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!noteId) return;
    let alive = true;
    gate.reset();
    setStatus("saved");
    setNewItemText("");
    setReminderPickerOpen(false);
    const cached = useNotesStore.getState().notes.find((n) => n.id === noteId);
  // Cache miss: clear the previous note's content so the honest "Loading"
  // panel paints instead of the old note's text under a fresh entrance.
  if (!cached && lastLoadedIdRef.current !== noteId) setNote(null);
  lastLoadedIdRef.current = noteId;
    // Note switch (or reopen) without a list cache hit: drop the previous
    // note's content *before paint* so the loading panel shows instead of
    // the old note's text for a frame. Cached switches apply synchronously
    // below and never paint stale content.
    if (!cached && lastLoadedIdRef.current !== noteId) {
      setNote(null);
      setDraft({ title: "", content: "", checklist: [], color: "default" });
    }
    lastLoadedIdRef.current = noteId;
    const apply = (n: Note) => {
      if (!alive) return;
      setNote(n);
      setEditorNote(n);
      // Don't clobber user edits that started before fresh data arrived.
      if (!gate.isDirty()) {
        setDraft({
          title: n.title,
          content: n.content,
          checklist: n.checklist,
          color: n.color,
        });
      }
    };
    if (cached) {
      apply(cached);
      // Revalidate in background so a stale list entry never becomes
      // the base for autosave overwrites.
      api.getNote(noteId).then(apply).catch(() => {});
    } else {
      api.getNote(noteId).then(apply).catch((e) => {
        if (!alive) return;
        showSnackbar(errText(e));
        closeEditor();
      });
    }
    return () => {
      alive = false;
    };
  }, [noteId, gate, setEditorNote, closeEditor, showSnackbar]);

  // ---- saving -------------------------------------------------------------
  // Stable identity: registered as the editor's flush callback (Ctrl+S,
  // Esc-close) and used by the blur/visibility/unmount safety nets. All
  // mutable save state lives inside the gate.
  const flush = useCallback(() => gateRef.current?.flush() ?? Promise.resolve(), []);

  useEffect(() => {
    registerEditorFlush(flush);
    return () => registerEditorFlush(null);
  }, [flush, registerEditorFlush]);

  // Safety net: if the editor unmounts with pending changes, write them out.
  // `dispose` afterwards cancels only *future* retries — an in-flight save
  // started here still runs to completion.
  useEffect(() => {
    return () => {
      if (gateRef.current?.isDirty()) void flush();
      gateRef.current?.dispose();
    };
  }, [flush]);

  // A11y: hand focus back to the card the editor was opened from when it
  // closes, instead of dumping keyboard users on <body>. Detected on the
  // noteId transition (this component stays mounted behind an early return,
  // so an unmount cleanup would never fire on plain close). Note switches
  // (value → value) intentionally do nothing: focus stays inside the editor.
  const lastOpenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastOpenIdRef.current && !noteId) {
      const id = useUiStore.getState().editorReturnFocusId;
      if (id) {
        const card = document.querySelector<HTMLElement>(
          `.note-card[data-note-id="${CSS.escape(id)}"]`,
        );
        card?.focus();
      }
    }
    lastOpenIdRef.current = noteId;
  }, [noteId]);

  // ---- close animation ------------------------------------------------------
  // The store clears `editorNoteId` as soon as the autosave flush lands, which
  // used to yank the editor off-screen mid-motion. Instead: on open→closed
  // transition, hold the last committed note + draft (the load effect refuses
  // to clear them, so the state *is* the snapshot) for one exit cycle, then
  // unmount. Reopening during the hold cancels it. `prefers-reduced-motion`
  // skips the hold entirely — CSS collapses the animation itself, and nobody
  // who asked for reduced motion should wait for the unmount hold at all.
  // Captured in a layout effect: a passive effect would leave one painted
  // frame between the store clearing noteId and the snapshot mounting,
  // which reads as a flicker. Setting state here re-renders before paint.
  const prevNoteIdRef = useRef(noteId);
  useLayoutEffect(() => {
    const prev = prevNoteIdRef.current;
    prevNoteIdRef.current = noteId;
    if (noteId) {
      setExitingId(null); // reopening mid-exit cancels the dying snapshot
      // A→B switch: ghost the outgoing panel (refs still hold the OLD note
      // here — the load effect runs after this one) under the new panel's
      // entrance, so switching crossfades instead of popping.
      if (
        prev &&
        prev !== noteId &&
        noteRef.current &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        swapSnapRef.current = { note: noteRef.current, draft: draftRef.current };
        setSwapId(prev);
      }
      return;
    }
    if (!prev || !noteRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setExitingId(prev);
  }, [noteId]);

  // The hold itself: matches editor-exit's duration; cancelled (and
  // restartable) if the editor reopens meanwhile.
  useEffect(() => {
    if (!exitingId) return;
    const t = window.setTimeout(() => setExitingId(null), 280);
    return () => window.clearTimeout(t);
  }, [exitingId]);

  // Ghost lifetime: outlives neither the new panel's entrance nor the user's
  // attention — one sink-and-fade, then gone.
  useEffect(() => {
    if (!swapId) return;
    const t = window.setTimeout(() => {
      setSwapId(null);
      swapSnapRef.current = null;
    }, 320);
    return () => window.clearTimeout(t);
  }, [swapId]);

  // A snapshot that is only aria-hidden stays *tabbable* for the length of
  // the exit animation — set `inert` (WebkitGTK supports it; React 18 types
  // don't list the attribute, hence the imperative set) so keyboard users
  // can't land inside a ghost, mirroring what aria-hidden promises AT.
  const exiting = noteId === null && exitingId !== null;
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !exiting) return;
    el.setAttribute("inert", "");
    return () => el.removeAttribute("inert");
  }, [exiting, noteId, exitingId]);

  // Auto-grow body textarea.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    const minH = draft.checklist.length > 0 ? 100 : 180;
    el.style.height = `${Math.max(el.scrollHeight, minH)}px`;
  }, [draft.content, draft.checklist.length, note]);

  // Also persist pending edits when the window loses focus / is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  const edit = (patch: Partial<Draft>) => {
    gate.dirty(); // marks unsaved changes and (re)arms the debounced save
    setDraft((d) => ({ ...d, ...patch }));
  };

  // ---- checklist ----------------------------------------------------------
  // Controlled input: single source of truth, no direct DOM mutation.
  // Enter and blur both commit; the second sees cleared state so no doubles.
  const addChecklistItem = () => {
    const text = newItemText.trim().slice(0, 500);
    if (!text) {
      newItemInputRef.current?.focus();
      return;
    }
    if (draftRef.current.checklist.length >= 500) {
      // import_backup restores at most 500 items — keep saves within that cap
      // so a backup round-trip never drops this checklist.
      showSnackbar("Checklists are limited to 500 items.");
      return;
    }
    setNewItemText("");
    edit({
      checklist: [
        ...draftRef.current.checklist,
        { id: newId(), text, checked: false },
      ],
    });
    newItemInputRef.current?.focus();
  };

  const setChecklistItem = (id: string, patch: Partial<ChecklistItem>) => {
    edit({
      checklist: draftRef.current.checklist.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  };

  const removeChecklistItem = (id: string) => {
    edit({ checklist: draftRef.current.checklist.filter((c) => c.id !== id) });
  };

  // ---- tags ---------------------------------------------------------------
  // Tag sets are full replacements, so two overlapping requests would let the
  // second overwrite the first with a pre-first-response snapshot
  // (lost-update). Toggles therefore run through one serial chain, each
  // reading the freshest known tags when it starts, and go through the store
  // (single IPC path + list sync) instead of calling api directly here.
  const tagChainRef = useRef<Promise<void>>(Promise.resolve());
  const applyTags = (tagId: string, apply: boolean) => {
    tagChainRef.current = tagChainRef.current.then(async () => {
      const currentNote = noteRef.current;
      if (!currentNote) return;
      const current = currentNote.tags.map((t) => t.id);
      const next = apply
        ? current.includes(tagId)
          ? current
          : [...current, tagId]
        : current.filter((t) => t !== tagId);
      if (next.length === current.length && apply) return; // already applied
      const tags = await useNotesStore.getState().setNoteTags(currentNote.id, next);
      if (!tags) return; // store already surfaced the error
      const updated = { ...(noteRef.current ?? currentNote), tags };
      noteRef.current = updated; // keep the chain's next read fresh pre-commit
      setNote(updated);
      setEditorNote(updated);
    });
  };

  // ---- flags ---------------------------------------------------------------
  // Keeps the editor's local note (and the shortcut-facing snapshot) in sync
  // with what the database now says, so toolbar state and Ctrl+Shift+P/F
  // toggles never go stale.
  const handleFlags = async (flags: FlagPatch) => {
    if (!note) return;
    const updated = await setFlags(note.id, flags);
    if (updated) {
      const merged = { ...noteRef.current!, ...updated };
      setNote(merged);
      setEditorNote(merged);
    }
  };

  // ---- reminders -----------------------------------------------------------
  // One-shot by design: the backend clears the time when the reminder fires, so
  // this is only ever "schedule" or "clear" — never a toggle of a spent one.
  const handleReminder = async (at: number | null) => {
    if (!note) return;
    const updated = await setReminder(note.id, at);
    if (!updated) return;
    const merged = { ...noteRef.current!, ...updated };
    setNote(merged);
    setEditorNote(merged);
    showSnackbar(at === null ? "Reminder cleared" : `Reminder set for ${formatDateTime(at)}`);
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      void flushAndCloseEditor();
    }
  };

  // aria-modal containment: only while genuinely open. The exit snapshot is
  // deliberately NOT trapped: focus already returned to the source card, and
  // the dying overlay is `inert` so its controls can't be tabbed through.
  useFocusTrap(editorRef, noteId !== null);

  const visibleId = noteId ?? exitingId;

  if (!visibleId) return null;
  if (!note) {
    return (
      <div
        className="editor-overlay"
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-label="Loading note"
        onClick={handleOverlayClick}
      >
        <div className="editor" key={visibleId} ref={editorRef}>
          <div className="editor-loading">Loading note…</div>
        </div>
      </div>
    );
  }

  const statusLabel =
    status === "saving" ? "Saving…" : status === "error" ? "Save failed" : "Saved";

  const stats = countWordsAndChars(draft.content, draft.checklist);

  return (
    <>
      {/* Switch-ghost: the outgoing note sinking away under the incoming
          panel's spring. Deliberately a lightweight copy (glass shell +
          old text, no controls) — it is fully covered by the real panel
          within a frame or two; only its edge motion is visible. */}
      {swapId && swapSnapRef.current && (
        <div className="editor-overlay is-swapping" aria-hidden="true">
          <div className={`editor color-${swapSnapRef.current.draft.color}`}>
            <div className="editor-ghost-body">
              <div className="editor-ghost-title">
                {swapSnapRef.current.draft.title || "Untitled Note"}
              </div>
              {/* Ghost only ever shows the first screenful — don't lay out
                  a 500k-char note for a 320ms fade. */}
              <div className="editor-ghost-text">
                {swapSnapRef.current.draft.content.slice(0, 2000)}
              </div>
            </div>
          </div>
        </div>
      )}
      <div
        className={exiting ? "editor-overlay is-exiting" : "editor-overlay"}
        ref={overlayRef}
        role={exiting ? undefined : "dialog"}
      aria-modal={exiting ? undefined : true}
      aria-label={exiting ? undefined : "Note editor"}
      aria-hidden={exiting || undefined}
      onClick={handleOverlayClick}
    >
      {/* key = note id: switching notes remounts the panel so the iOS-style
          entrance replays per note (and autoFocus lands the caret in the new
          title). Close keeps the same key (exitingId === last note id), so
          the class swap below runs the exit animation instead. */}
      <div className={`editor color-${draft.color}`} key={visibleId} ref={editorRef} onClick={(e) => e.stopPropagation()}>
        {/* Refined Header Toolbar */}
        <header className="editor-header">
          <div className="editor-header-left">
            <button
              type="button"
              className="icon-btn editor-close-btn"
              aria-label="Close editor (Esc)"
              title="Close (Esc)"
              onClick={() => void flushAndCloseEditor()}
            >
              <X size={18} />
            </button>
            <div
              className={`save-status-pill status-${status}`}
              role="status"
              aria-live="polite"
              title={`Save status: ${statusLabel}`}
            >
              <span className="save-status-dot" aria-hidden="true" />
              <span className="save-status-text">{statusLabel}</span>
            </div>
          </div>

          <div className="editor-header-actions">
            {/* Group 1: Organization & Appearance */}
            <div className="editor-toolbar-group">
              <div className="editor-popover-wrap">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Change note color"
                  title="Note color"
                  aria-expanded={colorPickerOpen}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setColorPickerOpen((v) => !v);
                    setTagPickerOpen(false);
                    setInlineTagPickerOpen(false);
                  }}
                >
                  <Palette size={16} />
                </button>
                {colorPickerOpen && (
                  <ColorPicker
                    value={draft.color}
                    onChange={(color) => edit({ color })}
                    onClose={() => setColorPickerOpen(false)}
                  />
                )}
              </div>

              <div className="editor-popover-wrap">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Manage tags"
                  title="Tags"
                  aria-expanded={tagPickerOpen}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setTagPickerOpen((v) => !v);
                    setColorPickerOpen(false);
                    setInlineTagPickerOpen(false);
                  }}
                >
                  <Tag size={16} />
                </button>
                {tagPickerOpen && note && (
                  <TagPicker
                    appliedTagIds={new Set(note.tags.map((t) => t.id))}
                    onToggle={(tag, apply) => void applyTags(tag.id, apply)}
                    onCreate={(name) => createTag(name)}
                    onClose={() => setTagPickerOpen(false)}
                  />
                )}
              </div>
            </div>

            <span className="editor-toolbar-sep" aria-hidden="true" />

            {/* Group 2: Document Flags & Export */}
            <div className="editor-toolbar-group">
              <button
                type="button"
                className={`icon-btn${note.pinned ? " active" : ""}`}
                aria-label={note.pinned ? "Unpin note" : "Pin note"}
                aria-pressed={note.pinned}
                title={note.pinned ? "Unpin (Ctrl+Shift+P)" : "Pin (Ctrl+Shift+P)"}
                onClick={() => void handleFlags({ pinned: !note.pinned })}
              >
                <Pin size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn${note.favorite ? " active" : ""}`}
                aria-label={note.favorite ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={note.favorite}
                title={note.favorite ? "Unfavorite (Ctrl+Shift+F)" : "Favorite (Ctrl+Shift+F)"}
                onClick={() => void handleFlags({ favorite: !note.favorite })}
              >
                <Star size={16} className={note.favorite ? "starred" : undefined} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={note.archived ? "Unarchive note" : "Archive note"}
                aria-pressed={note.archived}
                title={note.archived ? "Unarchive" : "Archive"}
                onClick={() => void handleFlags({ archived: !note.archived })}
              >
                {note.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              </button>
              <div className="editor-popover-wrap">
                <button
                  type="button"
                  className={`icon-btn${note.reminderAt != null ? " active" : ""}`}
                  aria-label={note.reminderAt != null ? "Change reminder" : "Set a reminder"}
                  aria-pressed={note.reminderAt != null}
                  aria-expanded={reminderPickerOpen}
                  title={
                    note.reminderAt != null
                      ? `Reminder ${formatReminderTime(note.reminderAt)}`
                      : "Remind me"
                  }
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setReminderPickerOpen((v) => !v);
                    setColorPickerOpen(false);
                    setTagPickerOpen(false);
                    setInlineTagPickerOpen(false);
                  }}
                >
                  <Bell size={16} />
                </button>
                {reminderPickerOpen && (
                  <ReminderPicker
                    value={note.reminderAt}
                    onSet={(at) => void handleReminder(at)}
                    onClose={() => setReminderPickerOpen(false)}
                  />
                )}
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Export note as Markdown"
                title="Export as Markdown (.md)"
                onClick={() => {
                  void (async () => {
                    const md = noteToMarkdown({
                      title: draft.title,
                      content: draft.content,
                      checklist: draft.checklist,
                      tags: note.tags,
                      createdAt: note.createdAt,
                      updatedAt: note.updatedAt,
                    });
                    const base = (draft.title || "note").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^\p{L}\p{N}-]+/gu, "_").replace(/_+/g, "_").slice(0, 80) || "note";
                    const filename = `${base}.md`;
                    // Rust writes to disk; webview blob downloads are unreliable
                    // in bundled WebKitGTK builds.
                    const path = await api.saveTextFile(filename, md);
                    showSnackbar(`Exported to ${path}`);
                  })();
                }}
              >
                <Download size={16} />
              </button>
            </div>

            <span className="editor-toolbar-sep" aria-hidden="true" />

            {/* Group 3: Destructive Action */}
            <div className="editor-toolbar-group">
              <button
                type="button"
                className="icon-btn danger-hover"
                aria-label="Move note to trash"
                title="Move to trash"
                onClick={() =>
                  askConfirm({
                    title: "Move to trash?",
                    message: "The note will move to Trash. You can restore it from there.",
                    confirmLabel: "Move to trash",
                    danger: true,
                    onConfirm: async () => {
                      await flush();
                      await trashNotes([note.id]);
                      closeEditor();
                    },
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>

            <span className="editor-toolbar-sep" aria-hidden="true" />

            {/* Group 4: Done finish button */}
            <button
              type="button"
              className="editor-done-btn"
              onClick={() => void flushAndCloseEditor()}
              title="Done (Esc)"
            >
              Done
            </button>
          </div>
        </header>

        {/* Scrollable Editorial Canvas */}
        <div className="editor-scroll">
          <div className="editor-body">
            {/* Document Header */}
            <div className="editor-doc-header">
              <input
                className="editor-title"
                value={draft.title}
                placeholder="Untitled Note"
                aria-label="Note title"
                autoFocus
                // Caps mirror the restore-side limit in import_backup so a note
                // saved here can always survive a backup round-trip.
                maxLength={5000}
                onChange={(e) => edit({ title: e.target.value })}
              />

              <div className="editor-meta-bar">
                <div className="editor-meta-info">
                  <Clock size={12} className="editor-meta-icon" aria-hidden="true" />
                  <span>Edited {formatRelativeTime(note.updatedAt)}</span>
                  <span className="editor-meta-bullet">·</span>
                  <span>{stats.words} {stats.words === 1 ? "word" : "words"}</span>
                </div>

                <div className="editor-meta-tags">
                  {note.tags.map((tag) => (
                    <span key={tag.id} className="editor-tag-chip">
                      <Hash size={11} aria-hidden="true" />
                      <span className="editor-tag-name">{tag.name}</span>
                      <button
                        type="button"
                        className="editor-tag-remove"
                        aria-label={`Remove tag ${tag.name}`}
                        title={`Remove tag ${tag.name}`}
                        onClick={() => void applyTags(tag.id, false)}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <div className="editor-popover-wrap">
                    <button
                      type="button"
                      className="editor-add-tag-btn"
                      aria-label="Add tag"
                      title="Add tag"
                      onClick={() => {
                        setInlineTagPickerOpen((v) => !v);
                        setTagPickerOpen(false);
                        setColorPickerOpen(false);
                      }}
                    >
                      <Plus size={11} />
                      <span>Tag</span>
                    </button>
                    {inlineTagPickerOpen && (
                      <TagPicker
                        appliedTagIds={new Set(note.tags.map((t) => t.id))}
                        onToggle={(tag, apply) => void applyTags(tag.id, apply)}
                        onCreate={(name) => createTag(name)}
                        onClose={() => setInlineTagPickerOpen(false)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="editor-divider" />

            {/* Note writing surface */}
            <textarea
              ref={bodyRef}
              className="editor-content"
              value={draft.content}
              placeholder="Take a note, or add checklist items below…"
              aria-label="Note content"
              // Mirrors import_backup's 500k-character restore cap.
              maxLength={500000}
              onChange={(e) => edit({ content: e.target.value })}
            />

            {/* Checklist Section */}
            <section className="editor-checklist" aria-label="Checklist">
              {draft.checklist.length > 0 && (
                <div className="checklist-section-header">
                  <span className="checklist-section-title">
                    Checklist ({draft.checklist.filter((i) => i.checked).length}/{draft.checklist.length})
                  </span>
                </div>
              )}
              {draft.checklist.map((item) => (
                <div key={item.id} className="checklist-item">
                  <button
                    type="button"
                    className={`checklist-toggle${item.checked ? " checked" : ""}`}
                    aria-pressed={item.checked}
                    aria-label={item.checked ? `Mark “${item.text}” unchecked` : `Mark “${item.text}” checked`}
                    onClick={() => setChecklistItem(item.id, { checked: !item.checked })}
                  >
                    {item.checked ? <Check size={12} /> : null}
                  </button>
                  <input
                    className={`checklist-text${item.checked ? " checked" : ""}`}
                    value={item.text}
                    aria-label="Checklist item"
                    onChange={(e) => setChecklistItem(item.id, { text: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm danger-hover checklist-delete"
                    aria-label={`Remove item ${item.text}`}
                    title="Remove item"
                    onClick={() => removeChecklistItem(item.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="checklist-item checklist-add">
                <div className="checklist-add-icon">
                  <Plus size={13} aria-hidden="true" />
                </div>
                <input
                  ref={newItemInputRef}
                  value={newItemText}
                  maxLength={500}
                  placeholder="Add item (Enter to add)…"
                  aria-label="New checklist item"
                  onChange={(e) => setNewItemText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addChecklistItem();
                      return;
                    }
                    if (e.key === "Escape" && newItemText) {
                      // Dismiss only the pending item — Escape with an empty
                      // field falls through to the global cascade (close editor).
                      e.stopPropagation();
                      setNewItemText("");
                    }
                  }}
                  onBlur={addChecklistItemOnBlur}
                />
              </div>
            </section>
          </div>
        </div>

        {/* Calm Editorial Footer */}
        <footer className="editor-footer">
          <div className="editor-footer-left">
            <span className="editor-stat-pill">
              {stats.words} {stats.words === 1 ? "word" : "words"}
            </span>
            <span className="editor-stat-pill">
              {stats.chars} {stats.chars === 1 ? "character" : "characters"}
            </span>
          </div>
          <div className="editor-footer-right">
            <span>Created {formatDateTime(note.createdAt)}</span>
            <span className="editor-footer-sep">·</span>
            <span>Last edited {formatDateTime(note.updatedAt)}</span>
          </div>
        </footer>
      </div>
    </div>
    </>
  );

  function addChecklistItemOnBlur() {
    if (newItemText.trim()) addChecklistItem();
  }
}


