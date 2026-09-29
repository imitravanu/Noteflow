/**
 * Pure tab-cycle math for useFocusTrap. Kept DOM-free (index arithmetic on a
 * list of elements) so wrap-around behavior is unit-testable in the node
 * environment, where the hook itself cannot run.
 */

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Index of the next focusable after `from`, wrapping around the ends.
 * `from` is compared by identity; -1 means "no current focus" (start at 0 /
 * last for shift). An empty list returns -1 — callers must handle it.
 */
export function nextFocusableIndex(
  count: number,
  from: number,
  shift: boolean,
): number {
  if (count <= 0) return -1;
  if (from < 0) return shift ? count - 1 : 0;
  const delta = shift ? -1 : 1;
  return (from + delta + count) % count;
}

/**
 * Whether `active` (document.activeElement) is one of `trapNodes` or nested
 * inside the container. When focus is already inside, Tab must cycle; when it
 * is outside (e.g. the user clicked a background element the trap missed),
 * bring it back to the first focusable instead of hijacking the click target.
 */
export function focusIsInside(
  active: EventTarget | null,
  container: Element | null,
): boolean {
  if (!container) return false;
  if (active === container) return true;
  return active instanceof Node && container.contains(active);
}
