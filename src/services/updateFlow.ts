import { useUiStore } from "../store/uiStore";
import {
  checkForUpdate,
  openReleasePage,
  relaunchApp,
  type AppUpdateInfo,
} from "./updater";

type SnackbarOpts = Parameters<ReturnType<typeof useUiStore.getState>["showSnackbar"]>[1];
const announced = new WeakSet<AppUpdateInfo>();

function toast(message: string, opts?: SnackbarOpts): void {
  useUiStore.getState().showSnackbar(message, opts);
}

/**
 * Surfaces an available update as a toast. Clicking "Update" IS the user's
 * confirmation: the download, signature verification, install, and relaunch
 * then run end-to-end without further prompts.
 */
export function announceUpdate(info: AppUpdateInfo): void {
  if (announced.has(info)) return;
  announced.add(info);
  let started = false;
  toast(`NoteFlow v${info.version} is available`, {
    actionLabel: "Update",
    action: () => {
      started = true;
      void runUpdate(info);
    },
    onDismiss: () => {
      if (!started) void info.close();
    },
  });
}

async function runUpdate(info: AppUpdateInfo): Promise<void> {
  const version = info.version;
  // `replace` claims the slot: the clicked "Update" toast hid itself, and a
  // progress readout may never sit behind the queue.
  toast(`Updating to v${version}…`, { replace: true });
  const installed = await info.install((percent) => {
    toast(`Updating to v${version}… ${percent}%`, { replace: true });
  });
  if (installed) {
    toast(`NoteFlow v${version} installed — restarting…`, { replace: true });
    // One beat so the confirmation toast renders before the process exits.
    setTimeout(() => {
      void relaunchApp().catch(() => {});
    }, 900);
    return;
  }
  // A .deb package, failed download, or failed signature check can all reject
  // installation. Report only what is known, then offer the release details.
  toast(`Automatic installation failed. NoteFlow was not updated. View v${version} release details.`, {
    replace: true,
    actionLabel: "Open",
    action: () => void openReleasePage(version).catch(() => {}),
  });
}

/** Launch-time check: silent unless there is something to announce. */
export async function checkOnLaunch(): Promise<void> {
  const result = await checkForUpdate();
  if (result.kind === "update") announceUpdate(result.info);
}

/** Settings → Software Update: every outcome gets reported. */
export async function checkManually(): Promise<void> {
  const result = await checkForUpdate();
  if (result.kind === "update") announceUpdate(result.info);
  else if (result.kind === "latest") toast(`NoteFlow ${__APP_VERSION__} is up to date.`);
  else toast("Could not check for updates. Check your connection and try again.");
}
