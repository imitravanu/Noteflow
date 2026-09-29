import { useRef, useState } from "react";
import { Check, Hash, Plus } from "lucide-react";
import type { Tag } from "../types";
import { useNotesStore } from "../store/notesStore";
import { usePopover } from "../hooks/usePopover";

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
  // Escape registration, outside-click close, and focus discipline
  // (shared by all pickers) live in usePopover.
  usePopover(ref, onClose);

  const submit = async () => {
    const name = newName.trim();
    if (!name || !onCreate) return;
    setNewName("");
    const tag = await onCreate(name);
    if (tag) onToggle(tag, true);
  };

  return (
    <div
      className="popover tag-picker"
      ref={ref}
      role="dialog"
      aria-label="Tags"
      // Focusable so usePopover can move focus into the popover on open.
      tabIndex={-1}
    >
      {/* A `menuitemcheckbox` must live under a `menu`; this popover is not a
          menu. Plain buttons with aria-pressed inside a labelled group give
          assistive tech the same toggle semantics with valid nesting. */}
      <div className="popover-list" role="group" aria-label="Applied tags">
        {tags.length === 0 && <p className="popover-empty">No tags yet</p>}
        {tags.map((tag) => {
          const applied = appliedTagIds.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className="popover-item"
              aria-pressed={applied}
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

