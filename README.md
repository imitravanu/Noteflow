# NoteFlow

Offline-first, keyboard-friendly notes for the Linux desktop (GNOME / Wayland).

Built with **Tauri 2 · Rust · React · TypeScript · Vite**. Notes live in a local
**SQLite** database (WAL mode) accessed through Rust — nothing leaves the machine.

## Development

```bash
npm install            # frontend dependencies
npm run dev            # vite dev server
npx tauri dev          # run the desktop app with hot reload

npm run typecheck      # tsc --noEmit
npm test               # vitest unit tests
cd src-tauri && cargo test   # Rust integration tests (real SQLite on disk)

npx tauri build        # release build (.deb and .AppImage bundles)
```

## Architecture

```
React UI  →  Tauri commands  →  Rust services  →  SQLite (WAL)
```

```
src/                      React frontend
  components/             Sidebar, TopBar, NoteCard, NoteEditor, ShortcutsModal, …
  pages/                  NotesPage, SettingsPage
  hooks/                  useTheme, useKeyboardShortcuts, useAppInit
  store/                  zustand stores (uiStore, notesStore)
  services/api.ts         typed invoke wrappers
  types/                  shared Note/Tag models
  styles/                 design tokens (global.css) + components.css
  utils/                  highlight, undo stack, formatting, markdown exporter (unit-tested)

src-tauri/src/            Rust backend
  commands/               thin #[tauri::command] handlers
  services/               note/tag/settings business logic
  database/               connection + migrations (user_version based)
  models/                 Note, Tag, ChecklistItem, patches
  error/                  AppError → user-facing messages
```

## Features

- **Rich Notes**: Title, body, colors, checklist items, tags, pinning, favorites, archiving, and trash.
- **Instant Search**: Local multi-field search (title, body, checklist, tag names) with match highlighting (`Ctrl+K`).
- **Autosave with Peace of Mind**: Debounced autosave with live status indicator; `Ctrl+S` forces immediate persistence.
- **Export & Backup**: Export individual notes as clean Markdown (`.md`) or export the entire workspace as a portable JSON backup.
- **Editor Statistics**: Live word count and character count in the editor footer.
- **Keyboard-First Workflow**: Comprehensive shortcut support (`Ctrl+N`, `Ctrl+K`, `Ctrl+S`, `Ctrl+Shift+P`, `Ctrl+Shift+F`, `Ctrl+A`, `Ctrl+Z`, `Delete`, `Esc`) plus a built-in shortcuts cheat sheet modal (`?` or `Ctrl+/`).
- **Safety & Undo**: Undo snackbar and `Ctrl+Z` stack for undoing actions, plus trash recovery with permanent deletion confirmation.
- **Multi-Selection**: Select multiple notes with click, `Ctrl+click`, `Shift+range`, or `Ctrl+A` for batch actions.
- **Appearance & Privacy**: Light, Dark, and System theme support with zero telemetry and 100% offline local SQLite storage (WAL mode).
- **Data Location**: `~/.local/share/com.noteflow.app/noteflow.db`

## License

[MIT License](LICENSE)

