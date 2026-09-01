import { useEffect } from "react";
import { useUiStore } from "../store/uiStore";

/**
 * Applies the selected theme to `<html data-theme>`; "system" follows the
 * desktop preference live via a matchMedia listener.
 */
export function useTheme() {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };

    apply();
    if (theme === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [theme]);
}

