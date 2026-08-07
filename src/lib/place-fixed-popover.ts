/** Preferred placement order: above → below → side. */
export type PopoverPlacement = "above" | "below" | "right" | "left";

export type RectLike = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type FixedPopoverPos = {
  top: number;
  left: number;
  maxWidth: number;
  maxHeight: number;
  placement: PopoverPlacement;
};

export type PlaceFixedPopoverOptions = {
  anchor: RectLike;
  /** Measured (or estimated) popover box. */
  size: { width: number; height: number };
  viewport?: { width: number; height: number };
  /** Gap between anchor edge and popover (px). */
  gap?: number;
  /** Inset from viewport edges (px). */
  pad?: number;
  prefer?: readonly PopoverPlacement[];
  /** Soft cap before viewport clamp. */
  maxWidth?: number;
  maxHeight?: number;
  /** Extra rects the popover must not cover (e.g. selected chip). */
  avoid?: readonly RectLike[];
};

const DEFAULT_PREFER: readonly PopoverPlacement[] = [
  "above",
  "below",
  "right",
  "left",
];

function intersects(
  box: { top: number; left: number; width: number; height: number },
  other: RectLike,
  gap: number,
): boolean {
  return !(
    box.left + box.width + gap <= other.left ||
    other.right + gap <= box.left ||
    box.top + box.height + gap <= other.top ||
    other.bottom + gap <= box.top
  );
}

function rawOrigin(
  placement: PopoverPlacement,
  anchor: RectLike,
  width: number,
  height: number,
  gap: number,
): { top: number; left: number } {
  const ax = anchor.left + anchor.width / 2;
  const ay = anchor.top + anchor.height / 2;
  switch (placement) {
    case "above":
      return { top: anchor.top - gap - height, left: ax - width / 2 };
    case "below":
      return { top: anchor.bottom + gap, left: ax - width / 2 };
    case "right":
      return { top: ay - height / 2, left: anchor.right + gap };
    case "left":
      return { top: ay - height / 2, left: anchor.left - gap - width };
  }
}

function clampBox(
  top: number,
  left: number,
  width: number,
  height: number,
  pad: number,
  vw: number,
  vh: number,
): { top: number; left: number } {
  const maxLeft = Math.max(pad, vw - pad - width);
  const maxTop = Math.max(pad, vh - pad - height);
  return {
    left: Math.min(Math.max(left, pad), maxLeft),
    top: Math.min(Math.max(top, pad), maxTop),
  };
}

function overflowArea(
  top: number,
  left: number,
  width: number,
  height: number,
  pad: number,
  vw: number,
  vh: number,
): number {
  const clamped = clampBox(top, left, width, height, pad, vw, vh);
  return Math.abs(clamped.left - left) + Math.abs(clamped.top - top);
}

function coversAnchor(
  box: { top: number; left: number; width: number; height: number },
  anchor: RectLike,
  gap: number,
): boolean {
  return intersects(box, anchor, gap);
}

/**
 * Place a `position:fixed` popover offset from an anchor so the target stays
 * visible. Prefers above, then below, then sides; flips near viewport edges.
 */
export function placeFixedPopover(
  opts: PlaceFixedPopoverOptions,
): FixedPopoverPos {
  const gap = opts.gap ?? 10;
  const pad = opts.pad ?? 8;
  const prefer = opts.prefer ?? DEFAULT_PREFER;
  const vw = opts.viewport?.width ?? 1024;
  const vh = opts.viewport?.height ?? 768;
  const avoid = opts.avoid ?? [];

  const maxWidth = Math.min(
    opts.maxWidth ?? opts.size.width,
    Math.max(40, vw - pad * 2),
  );
  const maxHeight = Math.min(
    opts.maxHeight ?? opts.size.height,
    Math.max(40, vh - pad * 2),
  );
  const width = Math.min(Math.max(opts.size.width, 1), maxWidth);
  const height = Math.min(Math.max(opts.size.height, 1), maxHeight);

  type Candidate = {
    placement: PopoverPlacement;
    top: number;
    left: number;
    score: number;
  };

  const candidates: Candidate[] = [];

  for (let i = 0; i < prefer.length; i++) {
    const placement = prefer[i]!;
    const raw = rawOrigin(placement, opts.anchor, width, height, gap);
    const clamped = clampBox(raw.top, raw.left, width, height, pad, vw, vh);
    const box = {
      top: clamped.top,
      left: clamped.left,
      width,
      height,
    };

    const shift = overflowArea(raw.top, raw.left, width, height, pad, vw, vh);
    const hitsAnchor = coversAnchor(box, opts.anchor, gap - 0.5);
    let hitsAvoid = false;
    for (const a of avoid) {
      if (intersects(box, a, gap - 0.5)) {
        hitsAvoid = true;
        break;
      }
    }

    // Lower is better. Prefer earlier placements; heavily penalize covering
    // the anchor or avoid-rects, then viewport shift.
    const score =
      i * 1_000 +
      (hitsAnchor ? 50_000 : 0) +
      (hitsAvoid ? 25_000 : 0) +
      shift * 10;

    candidates.push({
      placement,
      top: clamped.top,
      left: clamped.left,
      score,
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0]!;

  return {
    top: best.top,
    left: best.left,
    maxWidth,
    maxHeight,
    placement: best.placement,
  };
}

/** Build a RectLike from DOMRect / getBoundingClientRect. */
export function rectFromDom(r: DOMRect | RectLike): RectLike {
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

/** Union of several rects (for multi-point hover targets). */
export function unionRects(rects: readonly RectLike[]): RectLike | null {
  if (rects.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return {
    top,
    left,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
