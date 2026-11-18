import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUiStore } from "../store/uiStore";

/**
 * A close/restart waits on the editor's existing save gate: `flushEditor()`
 * resolves only after the latest draft — including edits typed while a write
 * was in flight — has been persisted. Nothing new is written here; the exit
 * path just refuses to leave until that flush says it is safe.
 */
export async function flushBeforeExit(): Promise<boolean> {
  try {
    return await useUiStore.getState().flushEditor();
  } catch {
    return false;
  }
}

/**
 * The draft is still in memory and the editor stays mounted. "Retry" re-runs
 * the same close/restart path, so the user never has to retype anything.
 */
export function showExitSaveError(retry: () => void): void {
  useUiStore.getState().showSnackbar(
    "Could not save your latest edits. NoteFlow stayed open — retry when storage is available.",
    {
      replace: true,
      actionLabel: "Retry",
      action: retry,
      persistent: true,
    },
  );
}

let exiting = false;

/**
 * Called after the window's close request has been prevented. Destroys the
 * window only once the flush succeeds; on failure it leaves the process
 * running with the draft intact and a retryable error on screen.
 */
export async function requestAppExit(): Promise<boolean> {
  if (exiting) return false;
  exiting = true;
  try {
    if (!(await flushBeforeExit())) {
      showExitSaveError(() => void requestAppExit());
      return false;
    }
    await getCurrentWindow().destroy();
    return true;
  } catch {
    showExitSaveError(() => void requestAppExit());
    return false;
  } finally {
    exiting = false;
  }
}
