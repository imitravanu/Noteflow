# Changelog

All notable changes to NoteFlow are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.4.1] - 2026-09-30

Chief-engineer audit follow-up: everything verified against source, every fix behind a regression test (Vitest 71 → 88).

### Fixed
- Snackbar: a due reminder (or any notification toast) no longer destroys a visible toast with a live affordance — newcomers queue behind it and surface when it auto-hides (capped FIFO). Undo-result feedback still claims the slot, since the clicked toast hid itself by definition.
- Tags: rapid tag toggles in the editor no longer lose updates — toggles run through a serial chain reading the freshest known tag set, through the store's `setNoteTags` (which now returns the server's tags) instead of a duplicated direct-IPC path with a redundant refetch.
- Autosave: opening another note (reminder toast "Open", card click while another editor is dirty) now flushes the current draft *before* the switch — previously the save-gate reset silently dropped up to a debounce window of edits, and an in-flight save could merge the old note's payload into the newly opened one.
- Escape: the confirm dialog closes through the global cascade, so Escape is no longer a dead key when focus falls outside the dialog subtree (React's stopPropagation could also unwind two layers at once when focus was inside).
- Grid: Space/Enter pressed on a card's inner buttons (pin, favorite, copy, check) activate those buttons instead of being hijacked into selection.
- Keyboard: Ctrl+Shift+P/F with a multi-note selection now flags the whole selection as one bulk transaction, matching the SelectionBar and the documented "Editor / Selection" scope (was: silently only selection[0]).
- Security/CSP: a single authoritative policy in `tauri.conf.json` (adds the `ipc:` connect sources Tauri requires and an explicit `script-src 'self'`); the contradictory meta CSP in `index.html` — which also blocked the inline theme pre-paint script in dev — is removed. Tauri hashes the inline script at bundle time. Release build verified: `tauri build` compiles and links with the new policy.
- Accessibility: closing the editor returns focus to the note card it was opened from instead of dumping keyboard users on `<body>`; the editor, confirm dialog and shortcuts modal now honour their `aria-modal` promise with a focus trap (Tab cycles inside, innermost surface wins, entry from `<body>` lands on the first control); the TopBar brand (role=button) is now keyboard-operable.
- Accessibility: the Settings theme control became a real radio widget — a single tab stop with roving tabindex and Arrow/Home/End selection-and-focus movement (the declared `radiogroup`/`radio` roles were previously keyboard-invalid); tag picker items switched from `menuitemcheckbox` (invalid without a `menu` ancestor) to `aria-pressed` buttons in a labelled group.

### Changed
- Note cards are memoized and no longer subscribe to the selection size, so autosave round-trips and selection changes no longer re-render every visible card; tilt/spotlight mousemove is coalesced to one layout read per frame; `will-change` is scoped to the hovered card (every card used to hold a permanent compositing layer).
- Types: `NotePatch.color`, `api.createNote` and `ColorPicker` use the `NoteColor` union instead of loose `string`.
- Popovers: color/tag/reminder pickers now share one `usePopover` hook — they take focus when opened and hand it back to the trigger on close (only if focus was still inside), so keyboard users are never left behind the popover. Selection-bar tagging moved to a new store action `setTagForSelection` (one atomic bulk call + full-list Undo, replacing a fire-and-forget direct-IPC path); finishing bulk actions clears the selection only when the user hasn't re-selected mid-flight (`clearSelectionIfUnchanged`).
- Design decision recorded in `NotesGrid`: no DOM virtualization — cards are tabbable and the product is keyboard-centric; `content-visibility: auto` + memoized cards already skip offscreen paint/layout while keeping Tab order, find-in-page and AT reading order intact.
- Tests: +17 across this release (71 → 88): flush-before-switch ×3, snackbar queue ×5, focus-cycle math ×5, scoped selection clear ×2, bulk tag + undo ×2.

## [1.4.0] - 2026-09-23

### Added
- **Reminders.** Every note has a one-shot reminder: open the editor's bell, pick a quick preset ("In 1 hour", "Tomorrow 9:00") or an exact `datetime-local` time, and the app announces it when it comes due — with an **Open** action that jumps straight to the note. A pending reminder shows as a bell badge on the card (labelled "Overdue" / "in 25m" / "tomorrow 09:00") and as an active toolbar button. Reminders are claimed from SQLite inside a single transaction, so each one fires exactly once, and one that came due while the app was closed still fires at the next launch instead of expiring silently. Firing is one-shot by design: the time clears when it fires, and archived/trashed notes stay quiet.
- **Unicode-aware indexed search.** Search now runs through FTS5 trigram indexes (`notes_fts`, `tags_fts`) created in schema v2, so it keeps the substring behaviour users expect (`"oat milk"` finds "buy oat milk") while folding unicode case the way `LIKE` never could — `CAFÉ` now finds `Café` — and does it with an index lookup per row instead of a full-table scan. Checklists and tag names are indexed as text (never raw JSON), and a legacy database is backfilled once on upgrade.
- Editor/window robustness: the reminder popover participates in the global Escape cascade like the color and tag pickers, closes on outside click, and resets when the editor switches notes.

### Changed
- Search queries shorter than 3 characters (below trigram width) keep the previous `LIKE` behaviour, including ASCII-only case folding; 1–2 character wildcards (`%`, `_`) remain escaped literals and never act as patterns.
- `README` refreshed for 1.4.0 (badges, download links, feature list, shortcuts).
- Versions stay single-sourced: `package.json` = `src-tauri/tauri.conf.json` = `src-tauri/Cargo.toml`, enforced by `npm run check:versions`.

### Fixed
- A reminder can no longer be announced twice, and can no longer be lost: claiming and clearing happen in the same SQLite transaction.

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
