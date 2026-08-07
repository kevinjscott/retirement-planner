export type UiFieldContext = {
  tag: string;
  id: string | null;
  name: string | null;
  type: string | null;
  label: string | null;
  ariaLabel: string | null;
  value: string | null;
  fieldPath: string | null;
  role: string | null;
};

/**
 * Voice deixis UI context. Focus (activeElement) is the sole pointer cue —
 * mouse hover / near-cursor targets are not tracked.
 */
export type PointerUiContext = {
  focused: UiFieldContext | null;
  updatedAt: number;
  /** True when a focused plan control is set. */
  hasTarget: boolean;
};

const CONTROL_SELECTOR =
  "input, select, textarea, button, [contenteditable='true'], [role='spinbutton'], [role='textbox'], [role='combobox'], [role='slider']";

/** Tight field shells — resolve to an inner focused control when present. */
const FIELD_SHELL_SELECTOR = [
  ".vbg-unit-field",
  ".vbg-field",
  "[data-field]",
  ".wealth-liquid-picker",
  ".vbg-custom-order-control",
  ".vbg-custom-check",
  ".vbg-custom-check-with-info",
].join(", ");

/** Row shells — describe the row host when focus is on the shell itself. */
const ROW_SHELL_SELECTOR = [
  ".vbg-custom-wealth-row",
  ".vbg-custom-events-row",
  ".vbg-custom-income-row",
].join(", ");

function isPlanControl(el: HTMLElement): boolean {
  if (el.closest(".vbg-voice-control")) return false;
  if (el.classList.contains("vbg-custom-info-btn")) return false;
  if (el.closest(".wealth-liquid-bubble")) return true;
  return true;
}

function describeHost(el: HTMLElement): UiFieldContext {
  const path = el.getAttribute("data-voice-path");
  const rowName = el.querySelector<HTMLInputElement>(
    'input.wealth-row-input, input[aria-label="Name"], input[aria-label="Retirement income name"]',
  );
  const nameVal = rowName?.value?.trim() || null;
  const balanceInput = el.querySelector<HTMLInputElement>(
    'input[aria-label="Balance"], .wealth-row-money input',
  );
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: null,
    type: null,
    label: nameVal ? `Row: ${nameVal}` : (path ?? "row"),
    ariaLabel: el.getAttribute("aria-label"),
    value: balanceInput?.value ?? nameVal,
    fieldPath: path,
    role: el.getAttribute("role"),
  };
}

/**
 * Resolve the editable control for a focused (or otherwise given) DOM node.
 * Never defaults to the first balance row / controls[0].
 */
export function resolveControl(el: Element | null): HTMLElement | null {
  if (!el) return null;

  const direct = el.closest(CONTROL_SELECTOR);
  if (direct instanceof HTMLElement && isPlanControl(direct)) {
    return direct;
  }

  const fieldShell = el.closest(FIELD_SHELL_SELECTOR);
  if (fieldShell instanceof HTMLElement) {
    // Never querySelector → controls[0]. Only the active element inside this
    // shell (real focus), never a default first balance control.
    const active =
      typeof document !== "undefined" ? document.activeElement : null;
    if (
      active instanceof HTMLElement &&
      fieldShell.contains(active) &&
      active.matches(CONTROL_SELECTOR) &&
      isPlanControl(active)
    ) {
      return active;
    }
  }

  const rowShell = el.closest(ROW_SHELL_SELECTOR);
  if (rowShell instanceof HTMLElement) {
    if (rowShell.hasAttribute("data-voice-path")) return rowShell;
    return null;
  }

  const voicePathHost = el.closest("[data-voice-path]");
  if (voicePathHost instanceof HTMLElement) {
    return voicePathHost;
  }

  return null;
}

function labelFor(el: HTMLElement): string | null {
  if (el.hasAttribute("data-voice-path") && el.matches(ROW_SHELL_SELECTOR)) {
    return describeHost(el).label;
  }
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) {
    const field = el.closest(ROW_SHELL_SELECTOR);
    const rowName = field?.querySelector<HTMLInputElement>(
      'input.wealth-row-input, input[aria-label="Name"], input[aria-label="Retirement income name"]',
    );
    const nameVal = rowName?.value?.trim();
    if (nameVal) return `${aria} (${nameVal})`;
    return aria;
  }
  const id = el.id;
  if (id) {
    const byFor = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (byFor?.textContent?.trim()) return byFor.textContent.trim();
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent?.trim()) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => {
      n.remove();
    });
    const text = clone.textContent?.trim();
    if (text) return text;
  }
  const field = el.closest(
    `.vbg-field, [data-field], ${ROW_SHELL_SELECTOR}, .vbg-account-row, .vbg-row`,
  );
  const fieldLabel = field?.querySelector(
    ".vbg-field-label, .vbg-label, label, [data-label]",
  );
  if (fieldLabel?.textContent?.trim()) return fieldLabel.textContent.trim();

  const rowName = field?.querySelector<HTMLInputElement>(
    'input.wealth-row-input, input[aria-label="Name"], input[aria-label="Retirement income name"]',
  );
  const nameVal = rowName?.value?.trim();
  if (nameVal) return nameVal;

  return null;
}

function readValue(el: HTMLElement): string | null {
  if (el.matches(ROW_SHELL_SELECTOR)) {
    return describeHost(el).value;
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") {
      return el.checked ? "true" : "false";
    }
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return el.textContent?.trim() || null;
}

function inferFieldPath(el: HTMLElement, label: string | null): string | null {
  const own =
    el.getAttribute("data-voice-path") ||
    el.getAttribute("data-field-path") ||
    el.getAttribute("data-field") ||
    el.dataset.fieldPath;
  if (own) return own;
  // Prefer the nearest path host, but not a distant ancestor outside the row.
  const host = el.closest("[data-voice-path]");
  if (host instanceof HTMLElement) {
    const path = host.getAttribute("data-voice-path");
    if (path) return path;
  }
  if (el.id) return el.id;
  if (el.getAttribute("name")) return el.getAttribute("name");
  return label;
}

export function describeElement(el: Element | null): UiFieldContext | null {
  const control = resolveControl(el);
  if (!control) return null;
  if (control.matches(ROW_SHELL_SELECTOR)) {
    return describeHost(control);
  }
  const label = labelFor(control);
  return {
    tag: control.tagName.toLowerCase(),
    id: control.id || null,
    name: control.getAttribute("name"),
    type:
      control instanceof HTMLInputElement
        ? control.type
        : control.getAttribute("type"),
    label,
    ariaLabel: control.getAttribute("aria-label"),
    value: readValue(control),
    fieldPath: inferFieldPath(control, label),
    role: control.getAttribute("role"),
  };
}

export function createEmptyPointerUiContext(): PointerUiContext {
  return {
    focused: null,
    updatedAt: Date.now(),
    hasTarget: false,
  };
}

export function formatPointerContextCue(ctx: PointerUiContext): string {
  const lines = [
    '[UI focus context — use for deixis like "this" / "that"]',
    "Only the focused field counts. Mouse hover is ignored.",
  ];
  if (ctx.focused) {
    lines.push(
      `Focused: ${ctx.focused.label ?? ctx.focused.fieldPath ?? ctx.focused.id ?? "control"}` +
        ` path=${ctx.focused.fieldPath ?? "?"} value=${ctx.focused.value ?? ""}`,
    );
  } else {
    lines.push("Focused: (none)");
  }
  if (!ctx.hasTarget) {
    lines.push(
      'NO TARGET — nothing is focused. Do not assume the first Current Holdings row or any account. Ask which field/account if the user says "this".',
    );
  }
  return lines.join("\n");
}

export function snapshotPointerUiContext(
  focusedEl: Element | null,
): PointerUiContext {
  const active =
    focusedEl ??
    (typeof document !== "undefined" ? document.activeElement : null);
  // Ignore document/body focus — that is not a plan field.
  const focusTarget =
    active instanceof HTMLElement &&
    active !== document.body &&
    active !== document.documentElement
      ? active
      : null;

  const focused = describeElement(focusTarget);
  return {
    focused,
    updatedAt: Date.now(),
    hasTarget: focused != null,
  };
}

/** Lightweight JPEG of the main calculator surface (no extra deps). */
export async function capturePlannerScreenshot(): Promise<{
  mimeType: string;
  base64: string;
  width: number;
  height: number;
} | null> {
  const root =
    (document.querySelector(".vbg-custom-screen") as HTMLElement | null) ??
    document.body;
  const rect = root.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(Math.min(rect.height, 1200)));
  const scale = Math.min(1, 1280 / width);

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8eef8";
  ctx.font = `${Math.max(12, 14 * scale)}px ui-sans-serif, system-ui, sans-serif`;
  let y = 24 * scale;
  ctx.fillText("Retirement planner — UI field map", 16 * scale, y);
  y += 22 * scale;

  const controls = Array.from(
    root.querySelectorAll<HTMLElement>(
      "input, select, textarea, button[aria-label], [data-voice-path]",
    ),
  ).slice(0, 60);

  for (const el of controls) {
    const desc = describeElement(el);
    if (!desc) continue;
    const line = `${desc.label ?? desc.fieldPath ?? desc.id ?? desc.tag}: ${desc.value ?? ""}`;
    ctx.fillStyle = "#9db0c9";
    ctx.fillText(line.slice(0, 90), 16 * scale, y);
    y += 16 * scale;
    if (y > canvas.height - 20) break;
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;
  return {
    mimeType: "image/jpeg",
    base64,
    width: canvas.width,
    height: canvas.height,
  };
}
