import { useEffect, useRef } from "react";
import { useUiStore } from "../store/uiStore";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function ConfirmDialog() {
  const confirm = useUiStore((s) => s.confirm);
  const closeConfirm = useUiStore((s) => s.closeConfirm);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);
  // aria-modal="true" promises containment; trap delivers it so Tab can no
  // longer escape into the background UI while a destructive action waits.
  useFocusTrap(dialogRef, confirm !== null);

  if (!confirm) return null;

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeConfirm();
      }}
      // Escape is owned by the global cascade (utils/escape.ts): handling it
      // here would (a) miss the key when focus falls outside this subtree and
      // (b) unwind two layers at once when focus is inside, because React's
      // stopPropagation cannot stop the native event from reaching the window
      // handler underneath.
    >
      <div
        className="dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        <h2 id="dialog-title" className="dialog-title">
          {confirm.title}
        </h2>
        <p id="dialog-message" className="dialog-message">
          {confirm.message}
        </p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={closeConfirm}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${confirm.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => {
              closeConfirm();
              void confirm.onConfirm();
            }}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

