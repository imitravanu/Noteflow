import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Pin } from "lucide-react";
import type { Note } from "../types";
import { useUiStore } from "../store/uiStore";
import { NoteCard } from "./NoteCard";

const PAGE_SIZE = 60;

interface NotesGridProps {
  notes: Note[];
  /** Rendered above the regular section (All view, no active search). */
  showPinnedSection: boolean;
}

export function NotesGrid({ notes, showPinnedSection }: NotesGridProps) {
  const query = useUiStore((s) => s.query);
  const selection = useUiStore((s) => s.selection);
  const orderedIds = useMemo(() => notes.map((n) => n.id), [notes]);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination whenever the underlying result set changes identity.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [notes]);

  // Infinite scroll: grow the rendered window instead of mounting every card.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, notes.length));
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

  const renderCards = (list: Note[]) =>
    list.map((note, i) => (
      <NoteCard
        key={note.id}
        note={note}
        selected={selectedSet.has(note.id)}
        orderedIds={orderedIds}
        query={query}
        style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
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
        <div className="notes-grid">{renderCards(visibleRegular)}</div>
      </section>
      {visibleCount < regular.length && <div ref={sentinelRef} className="grid-sentinel" />}
    </div>
  );
}

