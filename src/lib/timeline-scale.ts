/** Shared linear scales for chart SVG plots (series, hover, milestones). */

export const CHART_VIEW = {
  /** Fallback / SSR width until the viewport is measured. */
  w: 420,
  /** Dense plot; milestone labels live in the HTML rail below, not the SVG. */
  h: 132,
  padL: 36,
  padR: 8,
  padT: 8,
  /** Small gutter for axis + tick marks only (no label lanes). */
  padB: 14,
} as const;

export type ChartViewBox = {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
};

/** Tall cash-flow plot — 2× default viewBox height (CSS viewport doubles too). */
export const CHART_VIEW_TALL_H = CHART_VIEW.h * 2;

/** Build a viewBox whose width matches the rendered CSS pixel width (1:1). */
export function chartViewForWidth(
  widthPx: number,
  heightPx: number = CHART_VIEW.h,
): ChartViewBox {
  const w = Math.max(1, Math.round(widthPx));
  const h = Math.max(1, Math.round(heightPx));
  return {
    w,
    h,
    padL: CHART_VIEW.padL,
    padR: CHART_VIEW.padR,
    padT: CHART_VIEW.padT,
    padB: CHART_VIEW.padB,
  };
}

/** Map value ∈ [min, max] → 0…100 for CSS `left`. */
export function linearPct(value: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, ((value - min) / span) * 100));
}

/** Year-offset along [0, horizon] → % of the timeline track. */
export function timelineOffsetPct(yearOffset: number, horizon: number): number {
  return linearPct(yearOffset, 0, horizon);
}

/**
 * Index along chart rows → SVG x in the given viewBox.
 * Domain: index 0…rowCount-1 maps linearly across padL…(w−padR).
 */
export function chartIndexX(
  index: number,
  rowCount: number,
  view: ChartViewBox = CHART_VIEW,
): number {
  const plotW = view.w - view.padL - view.padR;
  const i = Math.max(0, Math.min(Math.max(rowCount - 1, 0), index));
  return view.padL + (i / Math.max(rowCount - 1, 1)) * plotW;
}
