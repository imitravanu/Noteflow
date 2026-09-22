import { useEffect, useId, useRef, useState } from "react";
import { Check, Hash, Plus } from "lucide-react";
import type { Tag } from "../types";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";

interface TagPickerProps {
  /** Tags already applied to every target note. */
  appliedTagIds: Set<string>;
  onToggle: (tag: Tag, apply: boolean) => void;
  onCreate?: (name: string) => Promise<Tag | null>;
  onClose: () => void;
}

/** Popover listing tags with an inline create field. */
export function TagPicker({ appliedTagIds, onToggle, onCreate, onClose }: TagPickerProps) {
  const tags = useNotesStore((s) => s.tags);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape is owned by the global cascade (see utils/escape.ts): register so
  // it closes *this* popover instead of the editor/selection underneath it.
  useEffect(() => {
    const { registerPopover, unregisterPopover } = useUiStore.getState();
    registerPopover(id, () => closeRef.current());
    return () => unregisterPopover(id);
  }, [id]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const submit = async () => {
    const name = newName.trim();
    if (!name || !onCreate) return;
    setNewName("");
    const tag = await onCreate(name);
    if (tag) onToggle(tag, true);
  };

  return (
    <div className="popover tag-picker" ref={ref} role="dialog" aria-label="Tags">
      <div className="popover-list">
        {tags.length === 0 && <p className="popover-empty">No tags yet</p>}
        {tags.map((tag) => {
          const applied = appliedTagIds.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className="popover-item"
              role="menuitemcheckbox"
              aria-checked={applied}
              onClick={() => onToggle(tag, !applied)}
            >
              <Hash size={14} aria-hidden="true" />
              <span className="popover-item-label">{tag.name}</span>
              {tag.noteCount ? (
                <span className="popover-item-count">{tag.noteCount}</span>
              ) : null}
              {applied && <Check size={14} className="popover-item-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {onCreate && (
        <div className="tag-picker-create">
          <Hash size={13} aria-hidden="true" />
          <input
            ref={inputRef}
            value={newName}
            placeholder="New tag…"
            aria-label="Create tag"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Create tag"
            title="Create tag"
            disabled={!newName.trim()}
            onClick={() => void submit()}
          >
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

