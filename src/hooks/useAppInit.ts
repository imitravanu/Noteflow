import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useNotesStore } from "../store/notesStore";
import { useUiStore } from "../store/uiStore";

/** Bootstraps persisted theme and the initial note list. */
export function useAppInit() {
  useEffect(() => {
    void useUiStore.getState().initTheme();
    if (isTauri()) void useNotesStore.getState().refresh();
    else useNotesStore.setState({ loading: false });
  }, []);
}

