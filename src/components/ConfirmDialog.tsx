import { useEffect, useRef } from "react";
import { useUiStore } from "../store/uiStore";

export function ConfirmDialog() {
  const confirm = useUiStore((s) => s.confirm);
  const closeConfirm = useUiStore((s) => s.closeConfirm);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);

  if (!confirm) return null;

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeConfirm();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closeConfirm();
        }
      }}
    >
      <div
        className="dialog"
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

