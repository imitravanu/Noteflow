import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useUiStore } from "../store/uiStore";

export function ConfirmDialog() {
  const confirm = useUiStore((s) => s.confirm);
  const closeConfirm = useUiStore((s) => s.closeConfirm);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Trap Tab inside the dialog and open on the safe action (Cancel), then
  // return focus to wherever the user was when it closes.
  useFocusTrap(dialogRef, confirm !== null, cancelRef);

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
        ref={dialogRef}
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

