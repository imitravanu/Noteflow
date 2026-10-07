import { useEffect } from "react";
import { X } from "lucide-react";
import { useUiStore } from "../store/uiStore";

const AUTO_HIDE_MS = 5000;

export function Snackbar() {
  const snackbar = useUiStore((s) => s.snackbar);
  const hideSnackbar = useUiStore((s) => s.hideSnackbar);

  useEffect(() => {
    if (!snackbar || snackbar.persistent) return;
    const t = window.setTimeout(() => hideSnackbar(snackbar.id), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [snackbar, hideSnackbar]);

  if (!snackbar) return null;

  return (
    <div className="snackbar" role="status" aria-live="polite" key={snackbar.id}>
      <span className="snackbar-message">{snackbar.message}</span>
      {snackbar.actionLabel && snackbar.action && (
        <button
          type="button"
          className="snackbar-action"
          onClick={() => {
            snackbar.action?.();
            hideSnackbar(snackbar.id);
          }}
        >
          {snackbar.actionLabel}
        </button>
      )}
      {snackbar.persistent && (
        <button
          type="button"
          className="snackbar-action"
          aria-label="Dismiss reminder"
          onClick={() => hideSnackbar(snackbar.id)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
