# Changelog

All notable changes to NoteFlow are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.1] - 2026-09-22

### Fixed
- Interaction: Escape now unwinds one layer at a time (confirm → shortcuts → popover → editor → selection → sidebar); Esc inside a color/tag picker no longer closes the note underneath, and Esc in the checklist "add item" field clears the pending item instead of closing the editor.
- Autosave: a save requested while another is in flight no longer strands the newest edits — the save gate chains a follow-up with the latest draft and only reports completion after it lands. Failed saves now auto-retry with capped exponential backoff (1s → 2s → 4s → 5s); the status pill says "Save failed" instead of the misleading "Offline".
- Undo: clicking Undo on an evicted stack entry explains "That action can no longer be undone."; Ctrl+Z on an empty stack says "Nothing to undo."
- Backup: the JSON round-trip is lossless — a top-level tag list is now restored on import, so tags attached to no note (orphans) survive export → wipe → import. Idempotent re-imports and case-insensitive name merges preserved.
- Highlight: bail out to plain text when unicode case-folding would change string length (e.g. "İ"), preventing mis-sliced match highlights.
- Accessibility: the off-canvas sidebar is `visibility: hidden` when closed, so its buttons and inputs leave the tab order and the accessibility tree.
- React hygiene: latest-value refs in the editor sync in layout effects after commit instead of during render.
- CI/Release: new `check:versions` gate (package.json = tauri.conf.json = Cargo.toml, and release tag must match); CI now also runs `vite build` so bundling errors can't first surface at release time.

### Added
- `set_tags_bulk` command: applying/removing a tag across a multi-note selection is one atomic chunked transaction (was N serial IPC round-trips), FK-safe against stale selections, with the tag validated up front.
- New regression tests: save-gate race/backoff/lifecycle (11), Escape cascade priority (8), orphan-tag round-trip and bulk tags (2 Rust), unicode highlight guard, popover registration and undo feedback (26 Rust + 59 vitest total).

## [1.3.0] - 2026-09-22

### Fixed
- CI: trigger on `main` (was `master`, so CI never ran); align Linux deps with README across `ci.yml` / `release.yml`.
- Backend: `now_millis()` is now strictly monotonic (`max(now, last+1)`), keeping `ORDER BY updated_at DESC` deterministic across NTP corrections.
- Store: `updateNote` re-sorts locally to match backend order; `emptyTrash` only clears optimistically in trash view.
- Editor: revalidate cached note in background without clobbering dirty draft; guard autosave with inflight lock and `noteRef` id.
- Utils: delay `URL.revokeObjectURL` 5s for WebKitGTK; unicode-safe truncated Markdown export filenames.
- Theme: pre-paint from `localStorage` cache to remove dark-mode flash; persist theme locally on set/init.
- UI: TopBar version derived from `__APP_VERSION__` (single source: `package.json`).
- Backend: `set_flags_bulk` + `export_all_notes` for atomic selection updates and consistent Settings backup.
- Frontend: selection flags use bulk endpoint; backup uses single export call.
- Backend: tag names limited by characters (not bytes) so unicode tags work; settings writes allowlisted (`theme` only) with value validation.

### Added
- Integration tests for bulk flags and full export (22 Rust tests total).
- Settings > Import Backup (JSON): safe restore that never overwrites existing notes, merges tags case-insensitively, caps 5000 notes.
- Frontend: `parseBackupJson`/`buildBackupPayload` helpers with tests; `uiStore` selection/undo coverage (34 vitest tests total).
- Accessibility: `prefers-reduced-motion` disables tilt/spotlight; grid uses `content-visibility` for large collections.
- Docs: PR safety checklist covering notes backup, typecheck, tests, fmt, clippy.

## [1.2.0] - 2026-09-01
- Offline-first Tauri 2 + SQLite (WAL) notes, tags, trash/restore, search, JSON backup export.
