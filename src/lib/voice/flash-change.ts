const FLASH_CLASS = "voice-change-flash";
const FLASH_MS = 1800;

function escapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Keep outermost hosts when wrapper + control share the same path. */
export function pickOutermostHosts<T extends { contains(other: T): boolean }>(
  exact: T[],
): T[] {
  return exact.filter(
    (el) => !exact.some((other) => other !== el && other.contains(el)),
  );
}

/**
 * Resolve DOM hosts for a changed path.
 * Only exact `data-voice-path` matches (plus scalar aliases) — never cascade
 * a field path like `accounts.{id}.balance` up to the row host.
 */
function collectTargets(path: string): HTMLElement[] {
  const exact = [
    ...document.querySelectorAll<HTMLElement>(
      `[data-voice-path="${escapeAttr(path)}"]`,
    ),
  ];

  // Scalar id aliases (e.g. inflationPct → inflation).
  if (path === "inflationPct") {
    document
      .querySelectorAll<HTMLElement>('[data-voice-path="inflation"]')
      .forEach((el) => exact.push(el));
  }
  if (path === "state") {
    document
      .querySelectorAll<HTMLElement>('[data-voice-path="stateCode"]')
      .forEach((el) => exact.push(el));
  }

  return pickOutermostHosts(exact);
}

/**
 * Briefly highlight DOM nodes tagged with `data-voice-path`.
 * Used after Voice mutations and after undo/redo of scenario edits.
 */
export function flashChangePaths(
  paths: string[] | undefined | null,
  durationMs = FLASH_MS,
): void {
  if (typeof document === "undefined" || !paths || paths.length === 0) return;

  const seen = new Set<HTMLElement>();
  const targets: HTMLElement[] = [];
  for (const path of paths) {
    if (!path) continue;
    for (const el of collectTargets(path)) {
      if (seen.has(el)) continue;
      seen.add(el);
      targets.push(el);
    }
  }
  if (targets.length === 0) return;

  for (const el of targets) {
    el.classList.remove(FLASH_CLASS);
    // Restart CSS animation if the same field is edited again quickly.
    void el.offsetWidth;
    el.classList.add(FLASH_CLASS);
    window.setTimeout(() => {
      el.classList.remove(FLASH_CLASS);
    }, durationMs);
  }
}

/** @deprecated Prefer {@link flashChangePaths}; kept for existing Voice call sites. */
export const flashVoicePaths = flashChangePaths;
