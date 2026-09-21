import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
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
import type { ChecklistItem, FlagPatch, Note, SaveStatus } from "../types";
import { api } from "../services/api";
import { useNotesStore } from "../store/notesStore";
import { errText, useUiStore } from "../store/uiStore";
import {
  countWordsAndChars,
  downloadFile,
  formatDateTime,
  formatRelativeTime,
  noteToMarkdown,
} from "../utils/format";
import { ColorPicker } from "./ColorPicker";
import { TagPicker } from "./TagPicker";

interface Draft {
  title: string;
  content: string;
  checklist: ChecklistItem[];
  color: string;
}

const AUTOSAVE_DELAY_MS = 600;

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
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [inlineTagPickerOpen, setInlineTagPickerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const dirtyRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const noteRef = useRef(note);
  noteRef.current = note;
  const inflightRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const newChecklistText = useRef<HTMLInputElement>(null);

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    if (!noteId) return;
    let alive = true;
    dirtyRef.current = false;
    setStatus("saved");
    const cached = useNotesStore.getState().notes.find((n) => n.id === noteId);
    const apply = (n: Note) => {
      if (!alive) return;
      setNote(n);
      setEditorNote(n);
      // Don't clobber user edits that started before fresh data arrived.
      if (!dirtyRef.current) {
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
  }, [noteId, setEditorNote, closeEditor, showSnackbar]);

  // ---- saving -------------------------------------------------------------
  const flush = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    if (inflightRef.current) return;
    if (!dirtyRef.current || !noteRef.current) return;
    const targetId = noteRef.current.id;
    if (!targetId) return;
    inflightRef.current = true;
    dirtyRef.current = false;
    setStatus("saving");
    try {
      const d = draftRef.current;
      const updated = await useNotesStore.getState().updateNote(targetId, {
        title: d.title,
        content: d.content,
        checklist: d.checklist,
        color: d.color,
      });
      if (updated) {
        setNote((prev) => (prev ? { ...prev, ...updated } : updated));
        setEditorNote(updated);
        setStatus("saved");
      } else {
        dirtyRef.current = true;
        setStatus("offline");
      }
    } finally {
      inflightRef.current = false;
    }
  }, [setEditorNote]);

  useEffect(() => {
    registerEditorFlush(flush);
    return () => registerEditorFlush(null);
  }, [flush, registerEditorFlush]);

  // Safety net: if the editor unmounts with pending changes, write them out.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void flush();
    };
  }, [flush]);

  // Debounced autosave.
  useEffect(() => {
    if (!note || !dirtyRef.current) return;
    setStatus("saving");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [draft, note, flush]);

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
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  // ---- checklist ----------------------------------------------------------
  const addChecklistItem = () => {
    const input = newChecklistText.current;
    const text = (input?.value ?? "").trim();
    if (!text) {
      input?.focus();
      return;
    }
    if (input) input.value = "";
    edit({
      checklist: [
        ...draftRef.current.checklist,
        { id: newId(), text, checked: false },
      ],
    });
    input?.focus();
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
  const applyTags = async (tagId: string, apply: boolean) => {
    if (!note) return;
    const current = note.tags.map((t) => t.id);
    const next = apply
      ? current.includes(tagId)
        ? current
        : [...current, tagId]
      : current.filter((t) => t !== tagId);
    try {
      const tags = await api.setNoteTags(note.id, next);
      const updated = { ...noteRef.current!, tags };
      setNote(updated);
      setEditorNote(updated);
      await useNotesStore.getState().refresh();
    } catch (e) {
      showSnackbar(errText(e));
    }
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

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      void flushAndCloseEditor();
    }
  };

  if (!noteId) return null;
  if (!note) {
    return (
      <div
        className="editor-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Loading note"
        onClick={handleOverlayClick}
      >
        <div className="editor">
          <div className="editor-loading">Loading note…</div>
        </div>
      </div>
    );
  }

  const statusLabel =
    status === "saving" ? "Saving…" : status === "offline" ? "Offline" : "Saved";

  const stats = countWordsAndChars(draft.content, draft.checklist);

  return (
    <div
      className="editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Note editor"
      onClick={handleOverlayClick}
    >
      <div className={`editor color-${draft.color}`} onClick={(e) => e.stopPropagation()}>
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
                    onChange={(color) => {
                      edit({ color });
                      dirtyRef.current = true;
                    }}
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
              <button
                type="button"
                className="icon-btn"
                aria-label="Export note as Markdown"
                title="Export as Markdown (.md)"
                onClick={() => {
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
                  downloadFile(filename, md, "text/markdown;charset=utf-8");
                  showSnackbar(`Exported as ${filename}`);
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
                  ref={newChecklistText}
                  placeholder="Add item (Enter to add)…"
                  aria-label="New checklist item"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addChecklistItem();
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
  );

  function addChecklistItemOnBlur() {
    const input = newChecklistText.current;
    if (input?.value.trim()) addChecklistItem();
  }
}


