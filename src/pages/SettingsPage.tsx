import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Database,
  Download,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import type { Theme } from "../types";
import { api } from "../services/api";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";
import { downloadFile } from "../utils/format";
import { buildBackupPayload, parseBackupJson } from "../utils/backup";

const THEMES: { value: Theme; label: string; description: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", description: "Bright surfaces for daytime", icon: Sun },
  { value: "dark", label: "Dark", description: "Deep tones for low light", icon: Moon },
  { value: "system", label: "System", description: "Follow your desktop setting", icon: Monitor },
];

export function SettingsPage() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const setPage = useUiStore((s) => s.setPage);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const showSnackbar = useUiStore((s) => s.showSnackbar);
  const tags = useNotesStore((s) => s.tags);

  const [dataDir, setDataDir] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useNotesStore((s) => s.refresh);

  useEffect(() => {
    api
      .getDataDir()
      .then(setDataDir)
      .catch(() => setDataDir(null));
  }, []);

  const handleExportBackup = async () => {
    try {
      setExporting(true);
      // Single atomic snapshot from backend (all views at once).
      const fullList = await api.exportAllNotes();

      const backup = buildBackupPayload(fullList, tags, __APP_VERSION__);

      const jsonStr = JSON.stringify(backup, null, 2);
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `noteflow-backup-${dateStr}.json`;
      downloadFile(filename, jsonStr, "application/json;charset=utf-8");
      showSnackbar(`Exported backup with ${fullList.length} notes`);
    } catch {
      showSnackbar("Failed to export backup.");
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      setImporting(true);
      const text = await file.text();
      let notes;
      try {
        notes = parseBackupJson(text);
      } catch {
        showSnackbar("Not a NoteFlow backup file.");
        return;
      }
      const count = await api.importBackup(notes);
      await refresh();
      showSnackbar(count === 0 ? "Nothing new — backup already imported." : `Imported ${count} note${count === 1 ? "" : "s"}.`);
    } catch {
      showSnackbar("Failed to import backup.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button
          type="button"
          className="icon-btn"
          aria-label="Back to notes"
          title="Back to notes"
          onClick={() => setPage("notes")}
        >
          <ArrowLeft size={18} />
        </button>
        <h1>Settings</h1>
      </header>

      <section className="settings-card" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance">
          <Palette size={16} aria-hidden="true" /> Appearance
        </h2>
        <div className="theme-options" role="radiogroup" aria-label="Theme">
          {THEMES.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              className={`theme-option${theme === value ? " active" : ""}`}
              onClick={() => setTheme(value)}
            >
              <span className="theme-option-icon">
                <Icon size={18} aria-hidden="true" />
                {theme === value && <Check size={12} className="theme-option-check" />}
              </span>
              <span className="theme-option-label">{label}</span>
              <span className="theme-option-description">{description}</span>
            </button>
          ))}
        </div>
        <div className="settings-glass-banner">
          <Sparkles size={15} className="theme-accent-color" aria-hidden="true" />
          <div className="settings-glass-banner-text">
            <strong>Liquid Glass Active</strong>
            <span>Apple OS 27 design language with continuous squircles, optical blur, and specular rim highlights.</span>
          </div>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="settings-backup">
        <h2 id="settings-backup">
          <Download size={16} aria-hidden="true" /> Data & Backup
        </h2>
        <p className="settings-muted">
          Export all your notes, checklists, and tags as a portable JSON backup file.
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={exporting}
            onClick={() => void handleExportBackup()}
          >
            <Download size={15} aria-hidden="true" />
            {exporting ? "Exporting…" : "Export Notes Backup (JSON)"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            <Download size={15} aria-hidden="true" />
            {importing ? "Importing…" : "Import Backup (JSON)"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Import backup file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
            }}
          />
        </div>
      </section>

      <section className="settings-card" aria-labelledby="settings-shortcuts">
        <h2 id="settings-shortcuts">
          <Keyboard size={16} aria-hidden="true" /> Keyboard Shortcuts
        </h2>
        <p className="settings-muted">
          Speed up your workflow with full keyboard navigation and quick actions.
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={15} aria-hidden="true" /> View Keyboard Shortcuts
          </button>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="settings-storage">
        <h2 id="settings-storage">
          <Database size={16} aria-hidden="true" /> Storage & Privacy
        </h2>
        <p className="settings-muted">
          Notes are stored offline in a local SQLite database (WAL mode). Nothing leaves this computer.
        </p>
        {dataDir && <code className="settings-path">{dataDir}</code>}
      </section>

      <section className="settings-card" aria-labelledby="settings-about">
        <h2 id="settings-about">
          <ShieldCheck size={16} aria-hidden="true" /> About NoteFlow
        </h2>
        <p className="settings-muted">
          NoteFlow {__APP_VERSION__} — Fast, offline-first notes for the Linux desktop.
        </p>
        <p className="settings-muted settings-about-fineprint">
          Built with Tauri 2, Rust, React, TypeScript, and SQLite. Released under the MIT License.
        </p>
      </section>
    </div>
  );
}

