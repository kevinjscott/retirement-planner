import type { CSSProperties } from "react";

/**
 * Global chart series colors — one meaning, one color across Balances + Cash flows.
 * Brand tokens: readable on light bg, no shared hue between different series.
 */
export const CHART_SERIES_COLORS = {
  // Balances — pretax/Roth share hues with their cash-flow draws
  taxable: "var(--vbg-gray-1000)",
  pretax: "var(--vbg-amber-900)",
  roth: "oklch(0.48 0.19 305)",
  retirement: "var(--vbg-blue-900)",
  education: "var(--vbg-gray-800)",
  // Cash flows — draws by source (no overlap with living/events/income/rmd)
  withdrawnTaxable: "var(--vbg-gray-1000)",
  withdrawnPretax: "var(--vbg-amber-900)",
  withdrawnRoth: "oklch(0.48 0.19 305)",
  eventFrom529: "oklch(0.42 0.11 200)",
  living: "var(--vbg-gray-700)",
  events: "var(--vbg-red-900)",
  income: "var(--vbg-green-900)",
  rmd: "var(--vbg-blue-700)",
  taxes: "oklch(0.48 0.16 28)",
  shortfall: "oklch(0.45 0.2 25)",
} as const;

export type ChartSeriesColorKey = keyof typeof CHART_SERIES_COLORS;

const FALLBACK = "var(--vbg-gray-1000)";

export function chartSeriesColor(key: string): string {
  if (key in CHART_SERIES_COLORS) {
    return CHART_SERIES_COLORS[key as ChartSeriesColorKey];
  }
  return FALLBACK;
}

/** Sets --vbg-series-color for stroke, fill, and legend swatches. */
export function chartSeriesStyle(key: string): CSSProperties {
  return { ["--vbg-series-color" as string]: chartSeriesColor(key) };
}
