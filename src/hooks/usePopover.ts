import { useEffect, useId, useRef, type RefObject } from "react";
import { useUiStore } from "../store/uiStore";

/**
 * Shared behavior for the editor/selection-bar popovers (color, tag,
 * reminder):
 *
 * 1. Registers with the global Escape cascade so Esc dismisses *only* the
 *    popover, never the editor/selection underneath (utils/escape.ts).
 * 2. Closes on outside mousedown.
 * 3. Focus discipline (a11y): the popover receives focus on open so
 *    keyboard users are inside it immediately, and on close focus returns
 *    to the triggering button — but only when it was still inside the
 *    popover (clicking elsewhere must not yank focus back onto the trigger).
 *
 * `onClose` may change identity every render; the latest is always called.
 */
export function usePopover(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const { registerPopover, unregisterPopover } = useUiStore.getState();
    registerPopover(id, () => closeRef.current());

    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("mousedown", onDown);

    // Capture the trigger (it holds focus after click/Enter activation).
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Move focus inside the popover itself.
    ref.current?.focus();

    return () => {
      document.removeEventListener("mousedown", onDown);
      unregisterPopover(id);
      const popover = ref.current;
      if (
        trigger &&
        trigger.isConnected &&
        (popover?.contains(document.activeElement) ||
          document.activeElement === document.body ||
          document.activeElement === null)
      ) {
        // Focus was inside the popover when it closed: hand it back so the
        // keyboard user's position in the UI is not lost.
        trigger.focus({ preventScroll: true });
      }
    };
  }, [id, ref]);
}
