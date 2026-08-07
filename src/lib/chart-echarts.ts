/**
 * ECharts setup + helpers for retirement charts (canvas series).
 * Resolves CSS color tokens so canvas strokes match the SVG/CSS legend.
 */

import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { chartSeriesColor } from "./chart-colors";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

export { echarts };

const FALLBACK_HEX: Record<string, string> = {
  taxable: "#111111",
  pretax: "#8a5a12",
  roth: "#7a2fa0",
  retirement: "#1a3a6b",
  education: "#444444",
  withdrawnTaxable: "#111111",
  withdrawnPretax: "#8a5a12",
  withdrawnRoth: "#7a2fa0",
  eventFrom529: "#1a6b7a",
  living: "#555555",
  events: "#9b2c2c",
  income: "#1f6b3a",
  rmd: "#2a5a9a",
  taxes: "#a33a2e",
  shortfall: "#b42318",
};

let probeEl: HTMLSpanElement | null = null;

/** Resolve a CSS color (incl. var()/oklch) to a canvas-safe rgb()/hex string. */
export function resolveCssColor(cssColor: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  if (!probeEl) {
    probeEl = document.createElement("span");
    probeEl.style.position = "absolute";
    probeEl.style.visibility = "hidden";
    probeEl.style.pointerEvents = "none";
    document.body.appendChild(probeEl);
  }
  probeEl.style.color = cssColor;
  const resolved = getComputedStyle(probeEl).color;
  return resolved && resolved !== "rgba(0, 0, 0, 0)" ? resolved : fallback;
}

export function echartsSeriesColor(key: string): string {
  const token = chartSeriesColor(key);
  return resolveCssColor(token, FALLBACK_HEX[key] ?? "#333333");
}

/** Compact axis ticks: $0, $100k, $1.0M */
export function fmtAxisMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const digits = m >= 10 || Number.isInteger(m) ? 0 : 1;
    return `${sign}$${m.toFixed(digits)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const digits = k >= 10 || Number.isInteger(k) ? 0 : 1;
    return `${sign}$${k.toFixed(digits)}k`;
  }
  return `${sign}$${Math.round(abs)}`;
}
