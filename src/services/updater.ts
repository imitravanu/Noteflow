import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Slim view of an available update (what the user gets shown). */
export interface AppUpdateInfo {
  version: string;
  notes: string;
}

/**
 * Result of an update check. `latest` = running the newest release;
 * `unavailable` = the check itself failed (offline, endpoint missing), which
 * the launch-time caller treats as silence and the manual one reports.
 */
export type UpdateCheck =
  | { kind: "update"; info: AppUpdateInfo }
  | { kind: "latest" }
  | { kind: "unavailable" };

/**
 * The plugin's Update handle is a Rust resource, not plain data: keep it
 * after `check()` so confirming the toast downloads *that* update without a
 * second network round-trip. Replaced on every fresh check.
 */
let pending: Update | null = null;

async function stash(update: Update | null): Promise<void> {
  const previous = pending;
  pending = update;
  if (previous && previous !== update) {
    await previous.close().catch(() => {});
  }
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  let update: Update | null;
  try {
    update = await check();
  } catch {
    // Offline, DNS blocked, or no signed `latest.json` on the release yet —
    // an update check must never surface as an app crash.
    await stash(null);
    return { kind: "unavailable" };
  }
  if (!update) {
    await stash(null);
    return { kind: "latest" };
  }
  await stash(update);
  return {
    kind: "update",
    info: { version: update.version, notes: update.body?.trim() ?? "" },
  };
}

/**
 * Downloads and installs the stashed update, reporting 0–100 progress.
 * Resolves `false` on signature/verification failure or when the running
 * package cannot replace its own binary in place (the system .deb on Linux),
 * so the caller can offer the manual download fallback.
 */
export async function installPendingUpdate(
  onProgress: (percent: number) => void,
): Promise<boolean> {
  const update = pending;
  if (!update) return false;
  let total = 0;
  let downloaded = 0;
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          if (total > 0) {
            onProgress(Math.min(99, Math.round((downloaded / total) * 100)));
          }
          break;
        case "Finished":
          onProgress(100);
          break;
      }
    });
  } catch {
    return false;
  }
  await update.close().catch(() => {});
  pending = null;
  return true;
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export async function openReleasePage(version: string): Promise<void> {
  await openUrl(`https://github.com/imitravanu/Noteflow/releases/tag/v${version}`);
}
