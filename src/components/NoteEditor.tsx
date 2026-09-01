import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  Circle,
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
import { countWordsAndChars, downloadFile, formatDateTime, noteToMarkdown } from "../utils/format";
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
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const dirtyRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const noteRef = useRef(note);
  noteRef.current = note;
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
    const load = cached ? Promise.resolve(cached) : api.getNote(noteId);
    load
      .then((n) => {
        if (!alive) return;
        setNote(n);
        setEditorNote(n);
        setDraft({
          title: n.title,
          content: n.content,
          checklist: n.checklist,
          color: n.color,
        });
      })
      .catch((e) => {
        if (!alive) return;
        showSnackbar(errText(e));
        closeEditor();
      });
    return () => {
      alive = false;
    };
  }, [noteId, setEditorNote, closeEditor, showSnackbar]);

  // ---- saving -------------------------------------------------------------
  const flush = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    if (!dirtyRef.current || !noteRef.current) return;
    dirtyRef.current = false;
    setStatus("saving");
    const d = draftRef.current;
    const updated = await useNotesStore.getState().updateNote(noteId!, {
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
  }, [noteId, setEditorNote]);

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
    el.style.height = `${Math.max(el.scrollHeight, 240)}px`;
  }, [draft.content, note]);

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

  if (!noteId) return null;
  if (!note) {
    return (
      <div className="editor-overlay" role="dialog" aria-modal="true" aria-label="Loading note">
        <div className="editor">
          <div className="editor-loading">Loading note…</div>
        </div>
      </div>
    );
  }

  const statusLabel =
    status === "saving" ? "Saving…" : status === "offline" ? "Offline — retrying on next edit" : "Saved";

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-label="Note editor">
      <div className={`editor color-${draft.color}`}>
        <header className="editor-header">
          <div className="editor-header-left">
            <button
              type="button"
              className="icon-btn"
              aria-label="Close editor (Esc)"
              title="Close (Esc)"
              onClick={() => void flushAndCloseEditor()}
            >
              <X size={18} />
            </button>
            <span
              className={`save-status status-${status}`}
              role="status"
              aria-live="polite"
            >
              <span className="save-status-dot" aria-hidden="true" />
              {statusLabel}
            </span>
          </div>

          <div className="editor-header-actions">
            <div className="editor-popover-wrap">
              <button
                type="button"
                className="icon-btn"
                aria-label="Change note color"
                title="Color"
                aria-expanded={colorPickerOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setColorPickerOpen((v) => !v);
                  setTagPickerOpen(false);
                }}
              >
                <Palette size={17} />
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
                aria-label="Edit tags"
                title="Tags"
                aria-expanded={tagPickerOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setTagPickerOpen((v) => !v);
                  setColorPickerOpen(false);
                }}
              >
                <Tag size={17} />
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

            <button
              type="button"
              className={`icon-btn${note.pinned ? " active" : ""}`}
              aria-label={note.pinned ? "Unpin note" : "Pin note"}
              aria-pressed={note.pinned}
              title={note.pinned ? "Unpin (Ctrl+Shift+P)" : "Pin (Ctrl+Shift+P)"}
              onClick={() => void handleFlags({ pinned: !note.pinned })}
            >
              <Pin size={17} />
            </button>
            <button
              type="button"
              className={`icon-btn${note.favorite ? " active" : ""}`}
              aria-label={note.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={note.favorite}
              title={note.favorite ? "Unfavorite (Ctrl+Shift+F)" : "Favorite (Ctrl+Shift+F)"}
              onClick={() => void handleFlags({ favorite: !note.favorite })}
            >
              <Star size={17} className={note.favorite ? "starred" : undefined} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={note.archived ? "Unarchive note" : "Archive note"}
              aria-pressed={note.archived}
              title={note.archived ? "Unarchive" : "Archive"}
              onClick={() => void handleFlags({ archived: !note.archived })}
            >
              {note.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Export note as Markdown"
              title="Export note as Markdown (.md)"
              onClick={() => {
                const md = noteToMarkdown({
                  title: draft.title,
                  content: draft.content,
                  checklist: draft.checklist,
                  tags: note.tags,
                  createdAt: note.createdAt,
                  updatedAt: note.updatedAt,
                });
                const cleanName = (draft.title || "note").trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, "_");
                const filename = `${cleanName || "note"}.md`;
                downloadFile(filename, md, "text/markdown;charset=utf-8");
                showSnackbar(`Exported as ${filename}`);
              }}
            >
              <Download size={17} />
            </button>
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
              <Trash2 size={17} />
            </button>
          </div>
        </header>

        <div className="editor-scroll">
          <div className="editor-body">
            <input
              className="editor-title"
              value={draft.title}
              placeholder="Title"
              aria-label="Note title"
              autoFocus
              onChange={(e) => edit({ title: e.target.value })}
            />
            <textarea
              ref={bodyRef}
              className="editor-content"
              value={draft.content}
              placeholder="Take a note…"
              aria-label="Note content"
              onChange={(e) => edit({ content: e.target.value })}
            />

            <section className="editor-checklist" aria-label="Checklist">
              {draft.checklist.map((item) => (
                <div key={item.id} className="checklist-item">
                  <button
                    type="button"
                    className={`checklist-toggle${item.checked ? " checked" : ""}`}
                    aria-pressed={item.checked}
                    aria-label={item.checked ? `Mark “${item.text}” unchecked` : `Mark “${item.text}” checked`}
                    onClick={() => setChecklistItem(item.id, { checked: !item.checked })}
                  >
                    {item.checked ? <Check size={13} /> : <Circle size={13} />}
                  </button>
                  <input
                    className={`checklist-text${item.checked ? " checked" : ""}`}
                    value={item.text}
                    aria-label="Checklist item"
                    onChange={(e) => setChecklistItem(item.id, { text: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm danger-hover"
                    aria-label={`Remove item ${item.text}`}
                    title="Remove item"
                    onClick={() => removeChecklistItem(item.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="checklist-item checklist-add">
                <Plus size={14} aria-hidden="true" />
                <input
                  ref={newChecklistText}
                  placeholder="Add checklist item…"
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

            {note.tags.length > 0 && (
              <div className="editor-tags">
                {note.tags.map((tag) => (
                  <span key={tag.id} className="chip chip-removable">
                    <Hash size={11} aria-hidden="true" />
                    {tag.name}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag.name}`}
                      onClick={() => void applyTags(tag.id, false)}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="editor-footer">
          {(() => {
            const stats = countWordsAndChars(draft.content, draft.checklist);
            return (
              <>
                <span>
                  {stats.words} {stats.words === 1 ? "word" : "words"} · {stats.chars}{" "}
                  {stats.chars === 1 ? "char" : "chars"}
                </span>
                <span aria-hidden="true">·</span>
              </>
            );
          })()}
          <span>Created {formatDateTime(note.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span>Edited {formatDateTime(note.updatedAt)}</span>
        </footer>
      </div>
    </div>
  );

  function addChecklistItemOnBlur() {
    const input = newChecklistText.current;
    if (input?.value.trim()) addChecklistItem();
  }
}


