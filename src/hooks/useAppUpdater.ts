import { useEffect } from "react";
import { checkOnLaunch } from "../services/updateFlow";

let launched = false; // at most one launch check per app run

/**
 * Checks GitHub Releases for a newer version shortly after startup. The delay
 * keeps the check out of the way of the initial note-list load; the flag is
 * set when the timer fires so StrictMode's double effect cannot stack two.
 */
export function useAppUpdater() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (launched) return;
      launched = true;
      void checkOnLaunch();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);
}
