const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab / Shift+Tab inside `container`. Returns true when it handled the key. */
export function trapTab(e: KeyboardEvent, container: HTMLElement): boolean {
  if (e.key !== "Tab") return false;
  const stops = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter((el) => el.getClientRects().length > 0);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) {
    e.preventDefault();
    container.focus();
    return true;
  }
  const active = document.activeElement;
  if (!container.contains(active) || (e.shiftKey && (active === first || active === container))) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
