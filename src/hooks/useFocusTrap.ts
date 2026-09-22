import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Keeps keyboard focus inside `container` while `active`, and hands it back to
 * whatever had it before — a modal that lets Tab escape leaves the user
 * typing into a page they cannot see behind the overlay.
 *
 * On entry, focus goes to `initialFocus` (or the first focusable child). On
 * release, the previously focused element is restored if it still exists.
 * The Tab interceptor only engages while focus is inside the container, so
 * programmatic focus elsewhere during teardown is never fought over.
 */
export function useFocusTrap(
  container: RefObject<HTMLElement | null>,
  active: boolean,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previous.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = () => {
      const root = container.current;
      if (!root) return;
      const target =
        initialFocus?.current ?? root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? root;
      target.focus();
    };
    focusFirst();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = container.current;
      if (!root) return;

      const activeEl = document.activeElement;
      // Focus escaped (e.g. via a click that didn't close the dialog): pull it
      // back instead of letting Tab walk further into the page behind.
      if (!activeEl || !root.contains(activeEl)) {
        e.preventDefault();
        focusFirst();
        return;
      }

      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const prev = previous.current;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [active, container, initialFocus]);
}
