const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab / Shift+Tab inside `container`. Returns true when it handled the key. */
export function trapTab(e: KeyboardEvent, container: HTMLElement): boolean {
  if (e.key !== "Tab") return false;
  const stops = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) {
    e.preventDefault();
    container.focus();
    return true;
  }
  const active = document.activeElement;
  const at = active instanceof HTMLElement ? stops.indexOf(active) : -1;
  if (at === -1) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return true;
  }
  if (e.shiftKey && at === 0) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && at === stops.length - 1) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
