import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Pin } from "lucide-react";
import type { Note } from "../types";
import { useUiStore } from "../store/uiStore";
import { NoteCard } from "./NoteCard";

const PAGE_SIZE = 60;

/**
 * Design note — why there is no DOM windowing here:
 * cards are tabbable and the product is keyboard-centric; a custom scroll
 * container (.content) + entrance animations mean virtualization would break
 * Tab-order continuity, find-in-page and AT reading order across window
 * boundaries, and re-trigger mount animations on every scroll tick. Paint/
 * layout cost for large collections is already handled by
 * `content-visibility: auto` (components.css) plus memoized cards, which skip
 * offscreen work while DOM identity stays intact. Revisit only if measurements
 * show reconciliation (not paint) dominating at realistic note counts.
 */

interface NotesGridProps {
  notes: Note[];
  /** Rendered above the regular section (All view, no active search). */
  showPinnedSection: boolean;
}

export function NotesGrid({ notes, showPinnedSection }: NotesGridProps) {
  const query = useUiStore((s) => s.query);
  const selection = useUiStore((s) => s.selection);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  // Read at event time (inside card handlers) instead of being passed down as
  // a fresh array per render — a new `orderedIds` identity every autosave would
  // defeat NoteCard's memo and re-render the whole grid.
  const getOrderedIds = useCallback(() => notesRef.current.map((n) => n.id), []);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const view = useUiStore((s) => s.view);
  const activeTagId = useUiStore((s) => s.activeTagId);
  // Reset pagination only when the query context changes. Resetting on `notes`
  // identity would fire after every autosave (each produces a new array) and
  // yank a scrolled list back to the first page.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [view, query, activeTagId]);

  // Infinite scroll: grow the rendered window instead of mounting every card.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, notesRef.current.length));
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [notes.length]);

  const pinned = showPinnedSection ? notes.filter((n) => n.pinned) : [];
  const regular = showPinnedSection ? notes.filter((n) => !n.pinned) : notes;
  const visibleRegular = regular.slice(0, visibleCount);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const renderCards = (list: Note[], delayOffset = 0) =>
    list.map((note, i) => (
      <NoteCard
        key={note.id}
        note={note}
        selected={selectedSet.has(note.id)}
        query={query}
        delayMs={Math.min((i + delayOffset) * 30, 600)}
        getOrderedIds={getOrderedIds}
      />
    ));

  if (notes.length === 0) {
    return (
      <div className="grid-empty" ref={sentinelRef}>
        <Inbox size={40} strokeWidth={1.4} aria-hidden="true" />
        <p>Nothing here</p>
      </div>
    );
  }

  return (
    <div className="notes-list">
      {pinned.length > 0 && (
        <section aria-label="Pinned notes">
          <h2 className="section-title">
            <Pin size={13} aria-hidden="true" /> Pinned
          </h2>
          <div className="notes-grid">{renderCards(pinned)}</div>
        </section>
      )}
      <section aria-label="Notes">
        {pinned.length > 0 && regular.length > 0 && <h2 className="section-title">Others</h2>}
        <div className="notes-grid">{renderCards(visibleRegular, Math.min(pinned.length, 20))}</div>
      </section>
      {visibleCount < regular.length && <div ref={sentinelRef} className="grid-sentinel" />}
    </div>
  );
}
