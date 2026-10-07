import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Each announcement owns the exact signed update handle returned by check. */
export interface AppUpdateInfo {
  version: string;
  notes: string;
  install: (onProgress: (percent: number) => void) => Promise<boolean>;
  close: () => Promise<void>;
}

export type UpdateCheck =
  | { kind: "update"; info: AppUpdateInfo }
  | { kind: "latest" }
  | { kind: "unavailable" };

let inFlightCheck: Promise<UpdateCheck> | null = null;

function candidate(update: Update): AppUpdateInfo {
  let closed = false;
  let installing = false;
  const close = async () => {
    if (closed || installing) return;
    closed = true;
    await update.close().catch(() => {});
  };

  return {
    version: update.version,
    notes: update.body?.trim() ?? "",
    close,
    install: async (onProgress) => {
      if (closed || installing) return false;
      installing = true;
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
        return true;
      } catch {
        return false;
      } finally {
        installing = false;
        await close();
      }
    },
  };
}

/** Overlapping launch/manual checks share one request and one candidate. */
export function checkForUpdate(): Promise<UpdateCheck> {
  if (inFlightCheck) return inFlightCheck;
  inFlightCheck = (async () => {
    try {
      const update = await check();
      return update
        ? { kind: "update" as const, info: candidate(update) }
        : { kind: "latest" as const };
    } catch {
      return { kind: "unavailable" as const };
    }
  })().finally(() => {
    inFlightCheck = null;
  });
  return inFlightCheck;
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export async function openReleasePage(version: string): Promise<void> {
  await openUrl(`https://github.com/imitravanu/Noteflow/releases/tag/v${version}`);
}
