import { describe, expect, test } from "bun:test";
import {
  CHART_VIEW,
  CHART_VIEW_TALL_H,
  chartIndexX,
  chartViewForWidth,
  linearPct,
  timelineOffsetPct,
} from "./timeline-scale";

describe("timeline-scale", () => {
  test("linearPct clamps to 0…100", () => {
    expect(linearPct(0, 0, 10)).toBe(0);
    expect(linearPct(5, 0, 10)).toBe(50);
    expect(linearPct(10, 0, 10)).toBe(100);
    expect(linearPct(-5, 0, 10)).toBe(0);
    expect(linearPct(15, 0, 10)).toBe(100);
    expect(linearPct(5, 5, 5)).toBe(0);
  });

  test("timelineOffsetPct matches year-offset domain", () => {
    expect(timelineOffsetPct(0, 40)).toBe(0);
    expect(timelineOffsetPct(20, 40)).toBe(50);
    expect(timelineOffsetPct(40, 40)).toBe(100);
  });

  test("chartIndexX maps endpoints to padL and w−padR", () => {
    const view = CHART_VIEW;
    const n = 11;
    expect(chartIndexX(0, n, view)).toBe(view.padL);
    expect(chartIndexX(n - 1, n, view)).toBe(view.w - view.padR);
    const mid = chartIndexX(5, n, view);
    expect(mid).toBeCloseTo(view.padL + 0.5 * (view.w - view.padL - view.padR), 6);
  });

  test("chartIndexX stays consistent when view width changes", () => {
    const wide = chartViewForWidth(840);
    const narrow = chartViewForWidth(420);
    const fracWide =
      (chartIndexX(3, 7, wide) - wide.padL) / (wide.w - wide.padL - wide.padR);
    const fracNarrow =
      (chartIndexX(3, 7, narrow) - narrow.padL) /
      (narrow.w - narrow.padL - narrow.padR);
    expect(fracWide).toBeCloseTo(fracNarrow, 10);
    expect(fracWide).toBeCloseTo(0.5, 10);
  });

  test("chartViewForWidth accepts tall height", () => {
    expect(CHART_VIEW_TALL_H).toBe(CHART_VIEW.h * 2);
    const tall = chartViewForWidth(420, CHART_VIEW_TALL_H);
    expect(tall.w).toBe(420);
    expect(tall.h).toBe(264);
    expect(tall.padT).toBe(CHART_VIEW.padT);
    expect(tall.padB).toBe(CHART_VIEW.padB);
  });
});
