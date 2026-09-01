import { ConfirmDialog } from "./components/ConfirmDialog";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { Sidebar } from "./components/Sidebar";
import { Snackbar } from "./components/Snackbar";
import { TopBar } from "./components/TopBar";
import { useAppInit } from "./hooks/useAppInit";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useTheme } from "./hooks/useTheme";
import { NotesPage } from "./pages/NotesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useUiStore } from "./store/uiStore";

export default function App() {
  useAppInit();
  useTheme();
  useKeyboardShortcuts();

  const page = useUiStore((s) => s.page);
  const selectionActive = useUiStore((s) => s.selection.length > 0);

  return (
    <div className="app" data-selection-active={selectionActive || undefined}>
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="content">
          {page === "settings" ? <SettingsPage /> : <NotesPage />}
        </div>
      </main>
      <Snackbar />
      <ConfirmDialog />
      <ShortcutsModal />
    </div>
  );
}


