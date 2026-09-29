import { useEffect, type RefObject } from "react";
import { FOCUSABLE_SELECTOR, nextFocusableIndex } from "../utils/focusTrap";

/**
 * Stack of active traps, innermost-last. Only the TOP trap answers Tab:
 * the editor's trap must not fight the confirm dialog opened above it, and
 * a popover is deliberately not a trap (it stays a plain dialog region).
 * Listened at window level, so Tab is caught even when focus has fallen to
 * <body> — the exact state a DOM-scoped onKeyDown could not recover from.
 */
const trapStack: symbol[] = [];

/**
 * Keeps Tab cycling inside `containerRef` while `active`. When focus is
 * outside the container, the next Tab pulls it to the first (Shift+Tab:
 * last) focusable instead of escaping into the background UI.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const token = Symbol("focus-trap");
    trapStack.push(token);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || trapStack[trapStack.length - 1] !== token) return;
      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        // Visible check via getClientRects (offsetParent is null inside
        // position:fixed subtrees and would wrongly drop everything here).
        (el) => el.getClientRects().length > 0 || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const activeEl = document.activeElement;
      const fromIndex =
        activeEl instanceof Node && container.contains(activeEl)
          ? items.indexOf(activeEl as HTMLElement)
          : -1; // outside → first (or last for Shift+Tab)
      const target = items[nextFocusableIndex(items.length, fromIndex, e.shiftKey)];
      if (!target) return;
      e.preventDefault();
      target.focus();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      // Remove our own token wherever it sits (out-of-order unmounts happen).
      const i = trapStack.indexOf(token);
      if (i !== -1) trapStack.splice(i, 1);
    };
  }, [active, containerRef]);
}
