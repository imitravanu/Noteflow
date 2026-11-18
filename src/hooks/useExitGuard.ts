import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { requestAppExit } from "../services/exitFlow";

/**
 * Intercepts the native window close (title-bar ×, Alt+F4, window manager)
 * before Tauri destroys the webview. The flush runs inside the prevented
 * close request, so the process — and the editor's draft — stay alive until
 * the write lands or the user chooses to retry.
 */
export function useExitGuard() {
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;
    const appWindow = getCurrentWindow();

    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await requestAppExit();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // If the listener cannot be installed, the OS close still works; there
        // is simply no additional flush on that path.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
