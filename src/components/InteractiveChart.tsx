"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DeferredNumberInput } from "@/components/DeferredNumberInput";
import { YearSliderPicker } from "@/components/YearSliderPicker";
import { chartSeriesStyle } from "@/lib/chart-colors";
import {
  echarts,
  echartsSeriesColor,
  fmtAxisMoney,
} from "@/lib/chart-echarts";
import type { ECharts } from "echarts/core";
import {
  RMD_DEFAULT_AGE,
  deflateToToday,
  fmtMoney,
  portfolioDrawParts,
  type PersonalMilestone,
  type TimelineMilestone,
  type TimelineMilestoneKind,
  type YearRow,
} from "@/lib/projection";
import {
  placeFixedPopover,
  rectFromDom,
  type FixedPopoverPos,
  type RectLike,
} from "@/lib/place-fixed-popover";
import {
  CHART_VIEW,
  CHART_VIEW_TALL_H,
  chartIndexX,
  chartViewForWidth,
} from "@/lib/timeline-scale";

export type ChartSeries = {
  key: string;
  label: string;
  /** Optional; color comes from chart-colors.ts by `key` (or `colorKey`). */
  colorClass?: string;
  /**
   * Color lookup when different from `key` (e.g. illiquid series share the
   * bucket hue via `colorKey: "taxable"`).
   */
  colorKey?: string;
  /** Line stroke; living/taxes keep legacy defaults when omitted. */
  lineType?: "solid" | "dashed" | "dotted";
  /** Optional legend hover tip (shown via title on the series label). */
  hint?: string;
  get: (r: YearRow) => number;
};

function seriesLineType(s: ChartSeries): "solid" | "dashed" | "dotted" {
  if (s.lineType) return s.lineType;
  if (s.key === "living") return "dashed";
  if (s.key === "taxes") return "dotted";
  return "solid";
}

function seriesColorKey(s: ChartSeries): string {
  return s.colorKey ?? s.key;
}

const KIND_CLASS: Record<TimelineMilestoneKind, string> = {
  income: "is-income",
  rmd: "is-rmd",
  event: "is-event",
  bucket: "is-bucket",
  depletion: "is-depletion",
  life: "is-life",
  draw: "is-draw",
  pinch: "is-pinch",
  personal: "is-personal",
};

const KIND_SHORT: Record<TimelineMilestoneKind, string> = {
  income: "Retirement income",
  rmd: "RMD",
  event: "Expense",
  bucket: "Account bucket",
  depletion: "Runway",
  life: "Life stage",
  draw: "Draw from pretax accounts",
  pinch: "Cash-flow pinch",
  personal: "Personal",
};

/** Match cash-flow markArea fill; legend swatch uses a slightly stronger tint. */
const PINCH_BAND_FILL = "rgba(180, 35, 24, 0.1)";
const PINCH_LEGEND_HINT =
  "Pink shaded years: liquid taxable can't bridge spend until pretax unlock (59½) or another locked account unlocks. Click the matching milestone below for detail.";

function milestoneDuration(m: TimelineMilestone): number {
  return Math.max(1, Math.round(m.durationYears ?? 1));
}

function milestoneEndOffset(m: TimelineMilestone): number {
  return m.yearOffset + milestoneDuration(m) - 1;
}

function milestoneBody(m: TimelineMilestone): string {
  switch (m.kind) {
    case "rmd":
      return (
        m.detail ||
        `Required Minimum Distributions (RMDs) are IRS-mandated annual withdrawals from traditional IRA / 401(k) accounts starting at age ${RMD_DEFAULT_AGE} — not tax advice.`
      );
    case "income":
    case "event":
    case "bucket":
    case "life":
    case "draw":
    case "pinch":
      return m.detail;
    case "depletion":
      return (
        m.detail ||
        `Portfolio balance reaches zero at age ${m.age} (${m.calendarYear}).`
      );
    case "personal":
      return m.label.trim() || "Personal milestone";
    default:
      return m.detail;
  }
}

function milestoneAria(m: TimelineMilestone): string {
  const dur = milestoneDuration(m);
  if (dur > 1) {
    return `${m.label}, ages ${m.age}–${m.age + dur - 1}, ${m.calendarYear}–${m.calendarYear + dur - 1}`;
  }
  return `${m.label}, age ${m.age}, ${m.calendarYear}`;
}

export function InteractiveChart({
  title,
  subtitle,
  rows,
  series,
  inflation = 0,
  calendarStartYear = new Date().getFullYear(),
  milestones,
  personalMilestones,
  currentAge,
  endAge,
  onAddPersonal,
  onChangePersonal,
  onRemovePersonal,
  showDrawBreakdown = false,
  pretaxUnlockAge,
  tall = false,
}: {
  title: string;
  /** Short caption under the title (e.g. what draws mean). */
  subtitle?: string;
  rows: YearRow[];
  series: ChartSeries[];
  /** When set, series values are shown in today's $ (nominal / (1+inflation)^year). */
  inflation?: number;
  calendarStartYear?: number;
  milestones?: TimelineMilestone[];
  personalMilestones?: PersonalMilestone[];
  currentAge?: number;
  endAge?: number;
  onAddPersonal?: () => void;
  onChangePersonal?: (id: string, patch: Partial<PersonalMilestone>) => void;
  onRemovePersonal?: (id: string) => void;
  /** Cash-flow hover: break draws into living / event gap / tax gross-up + by source. */
  showDrawBreakdown?: boolean;
  /** Balances chart: vertical mark at penalty-free pretax age (59½). */
  pretaxUnlockAge?: number;
  /** Double plot viewport height (cash-flow chart). */
  tall?: boolean;
}) {
  const figureRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const chartHostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const milestoneStripRef = useRef<HTMLDivElement>(null);
  const milestonePopupRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredMilestoneId, setHoveredMilestoneId] = useState<string | null>(
    null,
  );
  const [milestonePopupPos, setMilestonePopupPos] =
    useState<FixedPopoverPos | null>(null);
  const [viewportW, setViewportW] = useState<number>(CHART_VIEW.w);

  const viewH = tall ? CHART_VIEW_TALL_H : CHART_VIEW.h;
  const showMilestones = milestones !== undefined;
  const horizon = Math.max(rows.length - 1, 0);

  const orderedMilestones = useMemo(() => {
    if (!milestones?.length) return [];
    return [...milestones].sort((a, b) => {
      if (a.yearOffset !== b.yearOffset) return a.yearOffset - b.yearOffset;
      return a.label.localeCompare(b.label);
    });
  }, [milestones]);

  // Multi-year pinch windows → shaded markArea bands on cash flows.
  const pinchBandMilestones = useMemo(() => {
    if (!showDrawBreakdown || !milestones?.length) return [];
    return milestones.filter(
      (m) => m.kind === "pinch" && milestoneDuration(m) > 1,
    );
  }, [showDrawBreakdown, milestones]);

  const valueAt = (s: ChartSeries, r: YearRow) =>
    deflateToToday(s.get(r), inflation, r.year);

  const activeMilestoneId = selectedId ?? hoveredMilestoneId;
  const activeMilestone = useMemo(
    () => milestones?.find((m) => m.id === activeMilestoneId) ?? null,
    [milestones, activeMilestoneId],
  );

  const personalSelected =
    activeMilestone?.kind === "personal" &&
    activeMilestone.sourceId &&
    personalMilestones &&
    onChangePersonal
      ? personalMilestones.find((p) => p.id === activeMilestone.sourceId)
      : null;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const sync = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setViewportW((prev) => (prev === next ? prev : next));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Init / dispose ECharts instance
  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;
    const chart = echarts.init(host, undefined, {
      renderer: "canvas",
      width: viewportW,
      height: viewH,
    });
    chartRef.current = chart;
    return () => {
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Build / update option
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    chart.resize({ width: viewportW, height: viewH });

    const ages = rows.map((r) => r.age);
    // Pinch bands stay on cash flows; Pretax unlock (59½) is drawn on Balances.
    const pinchMilestones =
      showDrawBreakdown && milestones
        ? milestones.filter((m) => m.kind === "pinch")
        : [];
    const bridgeBands = pinchBandMilestones;
    const showChartMarks =
      showDrawBreakdown || pretaxUnlockAge != null;

    const echartsSeries = series.map((s, seriesIdx) => {
      const data = rows.map((r) => valueAt(s, r));
      const color = echartsSeriesColor(seriesColorKey(s));
      const stroke = seriesLineType(s);
      const base = {
        name: s.label,
        type: "line" as const,
        data,
        showSymbol: false,
        symbolSize: 6,
        sampling: "lttb" as const,
        lineStyle: {
          width: stroke === "dashed" ? 1.5 : 1.75,
          color,
          type: stroke,
        },
        itemStyle: { color },
        // Axis tooltip highlights every series; never blur/dim siblings (looks blank).
        emphasis: {
          disabled: true,
          focus: "none" as const,
        },
        blur: {
          lineStyle: { opacity: 1 },
          itemStyle: { opacity: 1 },
          areaStyle: { opacity: 1 },
        },
      };

      // Attach chart marks to the first series so they render once.
      if (seriesIdx !== 0 || !showChartMarks) return base;

      // Band color only — no markArea names. Overlapping pinch windows
      // otherwise stack long insideTop labels into illegible text; names
      // live on the legend, axis tooltip, and milestone strip instead.
      const markAreaData = showDrawBreakdown
        ? bridgeBands.map((m) => {
            const startAge = m.age;
            const endAge = m.age + milestoneDuration(m) - 1;
            return [
              {
                xAxis: String(startAge),
                itemStyle: { color: PINCH_BAND_FILL },
              },
              { xAxis: String(endAge) },
            ];
          })
        : [];

      const markLineData: Array<Record<string, unknown>> = [];
      if (pretaxUnlockAge != null) {
        markLineData.push({
          name: "Pretax unlock (59½)",
          xAxis: String(pretaxUnlockAge),
          label: {
            formatter: "Pretax unlock (59½)",
            position: "insideEndTop",
            color: "#5a3d00",
            fontSize: 10,
          },
          lineStyle: {
            color: "#8a5a12",
            type: "dashed",
            width: 1.5,
          },
        });
      }
      if (showDrawBreakdown) {
        for (const m of pinchMilestones) {
          if (m.kind === "pinch" && milestoneDuration(m) <= 1) {
            markLineData.push({
              name: m.label,
              xAxis: String(m.age),
              label: {
                formatter: m.label,
                position: "insideEndTop",
                color: "#7a1a12",
                fontSize: 10,
              },
              lineStyle: {
                color: "#b42318",
                type: "solid",
                width: 1.5,
              },
            });
          }
        }
      }

      return {
        ...base,
        markArea:
          markAreaData.length > 0
            ? {
                silent: true,
                emphasis: { disabled: true },
                label: { show: false },
                data: markAreaData,
              }
            : undefined,
        markLine:
          markLineData.length > 0
            ? {
                silent: true,
                symbol: "none",
                emphasis: { disabled: true },
                data: markLineData,
              }
            : undefined,
      };
    });

    // Balances: pin Y max to 1.5× today's largest series value so long-run
    // growth can clip; cash flows keep ECharts auto-scale.
    let balancesYMax: number | undefined;
    if (!showDrawBreakdown && rows[0]) {
      let maxToday = 0;
      for (const s of series) {
        const v = valueAt(s, rows[0]);
        if (Number.isFinite(v) && v > maxToday) maxToday = v;
      }
      if (maxToday > 0) balancesYMax = maxToday * 1.5;
    }

    chart.setOption(
      {
        animation: false,
        grid: {
          left: CHART_VIEW.padL,
          right: CHART_VIEW.padR,
          top: CHART_VIEW.padT,
          bottom: CHART_VIEW.padB,
          containLabel: false,
        },
        legend: { show: false },
        tooltip: {
          trigger: "axis",
          appendToBody: true,
          confine: false,
          axisPointer: {
            type: "line",
            snap: true,
            // Default true → highlight/downplay all series under the axis; with many
            // cash-flow lines that still dims the plot even when focus is "none".
            triggerEmphasis: false,
          },
          formatter: (params: unknown) => {
            const list = Array.isArray(params) ? params : [params];
            const first = list[0] as { dataIndex?: number } | undefined;
            const idx = first?.dataIndex ?? 0;
            const row = rows[idx];
            if (!row) return "";
            const head = `Y${row.year} · Age ${row.age} · ${calendarStartYear + row.year}${
              inflation > 0 ? " · today's $" : ""
            }`;
            const isZero = (n: number) => Math.abs(n) < 0.5;
            const swatch = (color: string) =>
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;flex-shrink:0"></span>`;
            const tipRow = (label: string, valueHtml: string, color: string) =>
              `<div style="display:flex;align-items:center;gap:0;line-height:1.45">${swatch(color)}<span>${label}: ${valueHtml}</span></div>`;

            // Draw-parts Taxable/Pretax/Roth mirror series draws — skip those keys
            // when series already lists them; keep only true extras (tax gross-up
            // not covered by Taxes, RMD note on pretax).
            const seriesKeys = new Set(series.map((s) => s.key));
            const money = (n: number) =>
              fmtMoney(deflateToToday(n, inflation, row.year), true);
            const pretaxRmdNote =
              showDrawBreakdown &&
              seriesKeys.has("withdrawnPretax") &&
              !isZero(row.rmd)
                ? ` (incl. RMD ${money(row.rmd)})`
                : "";

            const lines = series
              .map((s) => {
                const v = valueAt(s, row);
                if (isZero(v)) return null;
                const valueHtml =
                  s.key === "withdrawnPretax" && pretaxRmdNote
                    ? `${fmtMoney(v, true)}${pretaxRmdNote}`
                    : fmtMoney(v, true);
                return tipRow(
                  s.label,
                  valueHtml,
                  echartsSeriesColor(seriesColorKey(s)),
                );
              })
              .filter((x): x is string => x != null);

            let extra = "";
            if (showDrawBreakdown) {
              const parts = portfolioDrawParts(row);
              const breakdown: string[] = [];
              // Only list bucket draws when the chart series does not already.
              if (
                !seriesKeys.has("withdrawnTaxable") &&
                !isZero(parts.withdrawnTaxable)
              ) {
                breakdown.push(
                  tipRow(
                    "Draw from taxable accounts",
                    money(parts.withdrawnTaxable),
                    echartsSeriesColor("withdrawnTaxable"),
                  ),
                );
              }
              if (
                !seriesKeys.has("withdrawnPretax") &&
                !isZero(parts.withdrawnPretax)
              ) {
                const rmdNote = !isZero(row.rmd)
                  ? ` (incl. RMD ${money(row.rmd)})`
                  : "";
                breakdown.push(
                  tipRow(
                    "Draw from pretax accounts",
                    `${money(parts.withdrawnPretax)}${rmdNote}`,
                    echartsSeriesColor("withdrawnPretax"),
                  ),
                );
              }
              if (
                !seriesKeys.has("withdrawnRoth") &&
                !isZero(parts.withdrawnRoth)
              ) {
                breakdown.push(
                  tipRow(
                    "Draw from Roth accounts",
                    money(parts.withdrawnRoth),
                    echartsSeriesColor("withdrawnRoth"),
                  ),
                );
              }
              // taxes series already shows the same amount when taxes > 0.
              if (
                !isZero(parts.taxGrossUp) &&
                !(seriesKeys.has("taxes") && !isZero(row.taxes))
              ) {
                breakdown.push(
                  tipRow(
                    "Tax gross-up",
                    money(parts.taxGrossUp),
                    echartsSeriesColor("taxes"),
                  ),
                );
              }
              if (breakdown.length > 0) {
                extra =
                  `<div style="margin-top:6px;opacity:0.85">${breakdown.join("")}</div>`;
              }

              const pinchesHere = pinchMilestones.filter((m) => {
                const end = m.age + milestoneDuration(m) - 1;
                return row.age >= m.age && row.age <= end;
              });
              if (pinchesHere.length > 0) {
                const kinds = [...new Set(pinchesHere.map((m) => m.label))];
                const pinchSwatch = `<span style="display:inline-block;width:10px;height:8px;border-radius:2px;background:rgba(180,35,24,0.22);box-shadow:inset 0 0 0 1px rgba(180,35,24,0.45);margin-right:6px;vertical-align:middle;flex-shrink:0"></span>`;
                extra +=
                  `<div style="margin-top:6px;display:flex;align-items:center;gap:0;line-height:1.45;color:#7a1a12">${pinchSwatch}<span>Cash-flow pinch: ${kinds.join(" · ")}</span></div>`;
              }
            }
            const mainRows = lines.join("");
            const mainBlock =
              mainRows.length > 0
                ? `<div style="margin-top:4px">${mainRows}</div>`
                : !extra
                  ? `<div style="margin-top:4px;opacity:0.6">—</div>`
                  : "";
            return `<div><strong>${head}</strong>${mainBlock}${extra}</div>`;
          },
        },
        xAxis: {
          type: "category",
          data: ages,
          boundaryGap: false,
          axisLabel: {
            fontSize: 10,
            color: "#888",
            formatter: (v: string | number, i: number) => {
              if (i === 0 || i === ages.length - 1 || i === Math.floor(ages.length / 2)) {
                return String(v);
              }
              return "";
            },
          },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: "#ddd" } },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          min: 0,
          ...(balancesYMax != null ? { max: balancesYMax } : {}),
          axisLabel: {
            fontSize: 10,
            color: "#888",
            formatter: (v: number) => fmtAxisMoney(v),
            margin: 4,
          },
          splitLine: { lineStyle: { color: "#eee", type: "solid" } },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: echartsSeries,
      },
      { notMerge: true },
    );
  }, [
    rows,
    series,
    inflation,
    viewportW,
    viewH,
    calendarStartYear,
    showDrawBreakdown,
    pretaxUnlockAge,
    milestones,
    pinchBandMilestones,
  ]);

  useEffect(() => {
    if (!selectedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    function onPointer(e: MouseEvent) {
      if (!figureRef.current?.contains(e.target as Node)) {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [selectedId]);

  useLayoutEffect(() => {
    if (!activeMilestone) {
      setMilestonePopupPos(null);
      return;
    }
    const sync = () => {
      const id = activeMilestone.id;
      const mark = figureRef.current?.querySelector(
        `[data-milestone-mark="${CSS.escape(id)}"]`,
      );
      const chip = figureRef.current?.querySelector(
        `[data-milestone-chip="${CSS.escape(id)}"]`,
      );
      const popup = milestonePopupRef.current;
      const strip = milestoneStripRef.current ?? viewportRef.current;
      if (!strip) return;

      const anchor = mark
        ? rectFromDom(mark.getBoundingClientRect())
        : rectFromDom(strip.getBoundingClientRect());

      const avoid: RectLike[] = [];
      if (chip) avoid.push(rectFromDom(chip.getBoundingClientRect()));

      const maxWidth = Math.min(22 * 16, Math.max(160, window.innerWidth - 16));
      const maxHeight = Math.min(20 * 16, window.innerHeight - 16);
      const size = popup
        ? { width: popup.offsetWidth, height: popup.offsetHeight }
        : { width: maxWidth, height: 140 };

      setMilestonePopupPos((prev) => {
        const next = placeFixedPopover({
          anchor,
          size,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          gap: 10,
          pad: 8,
          maxWidth,
          maxHeight,
          avoid,
        });
        if (
          prev &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.maxWidth === next.maxWidth &&
          prev.maxHeight === next.maxHeight &&
          prev.placement === next.placement
        ) {
          return prev;
        }
        return next;
      });
    };
    sync();
    const popup = milestonePopupRef.current;
    const ro = popup ? new ResizeObserver(sync) : null;
    if (popup && ro) ro.observe(popup);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [activeMilestone, personalSelected, rows.length, viewportW]);

  const selectMilestone = (id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  };

  const canManagePersonal =
    typeof currentAge === "number" &&
    typeof endAge === "number" &&
    onAddPersonal &&
    onChangePersonal &&
    onRemovePersonal;
  const personalHorizon =
    typeof currentAge === "number" && typeof endAge === "number"
      ? Math.max(0, endAge - currentAge)
      : horizon;

  const stripView = useMemo(
    () => chartViewForWidth(viewportW, 28),
    [viewportW],
  );

  return (
    <figure
      ref={figureRef}
      className={`vbg-chart vbg-custom-chart${showMilestones ? " has-milestones" : ""}${selectedId ? " is-milestone-open" : ""}`}
    >
      <div className="vbg-chart-header vbg-custom-chart-head">
        <div className="vbg-custom-chart-title-block">
          <p className="vbg-label">{title}</p>
          {subtitle ? (
            <p className="vbg-meta vbg-custom-chart-sub">{subtitle}</p>
          ) : null}
        </div>
        <div className="vbg-custom-chart-head-actions">
          <div className="vbg-custom-legend">
            {series.map((s) => {
              const stroke = seriesLineType(s);
              const strokeClass =
                stroke === "dotted"
                  ? "is-dotted"
                  : stroke === "dashed"
                    ? "is-dashed"
                    : "";
              return (
                <span
                  key={s.key}
                  className={`vbg-custom-legend-item ${s.colorClass ?? ""} ${strokeClass}`.trim()}
                  style={chartSeriesStyle(seriesColorKey(s))}
                  title={s.hint || undefined}
                >
                  {s.label}
                </span>
              );
            })}
            {pinchBandMilestones.length > 0 ? (
              <span
                className="vbg-custom-legend-item is-pinch-band"
                title={PINCH_LEGEND_HINT}
              >
                Cash-flow pinch
              </span>
            ) : null}
          </div>
          {canManagePersonal ? (
            <button
              type="button"
              className="vbg-button"
              data-variant="secondary"
              onClick={onAddPersonal}
            >
              + Milestone
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`vbg-chart-viewport vbg-custom-chart-viewport${tall ? " is-tall" : ""}`}
      >
        <div
          ref={chartHostRef}
          className="vbg-custom-echart-host"
          role="img"
          aria-label={title}
          style={{ width: viewportW, height: viewH }}
        />
      </div>

      {showMilestones ? (
        <div
          ref={milestoneStripRef}
          className="vbg-custom-milestone-strip"
          aria-label="Milestones timeline"
        >
          <svg
            viewBox={`0 0 ${stripView.w} ${stripView.h}`}
            width={stripView.w}
            height={stripView.h}
            preserveAspectRatio="none"
            className="vbg-custom-milestone-strip-svg"
          >
            <line
              className="vbg-custom-milestone-strip-axis"
              x1={stripView.padL}
              x2={stripView.w - stripView.padR}
              y1={stripView.h / 2}
              y2={stripView.h / 2}
            />
            {orderedMilestones.map((m) => {
              const isSpan = milestoneDuration(m) > 1;
              const x0 = chartIndexX(m.yearOffset, rows.length, stripView);
              const x1 = chartIndexX(
                milestoneEndOffset(m),
                rows.length,
                stripView,
              );
              const midX = (x0 + x1) / 2;
              const isHot =
                activeMilestoneId === m.id || selectedId === m.id;
              const cy = stripView.h / 2;
              return (
                <g
                  key={m.id}
                  data-milestone-mark={m.id}
                  className={`vbg-custom-milestone-mark ${KIND_CLASS[m.kind]}${
                    isSpan ? " is-span" : ""
                  }${isHot ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={milestoneAria(m)}
                  aria-pressed={selectedId === m.id}
                  onPointerEnter={() => setHoveredMilestoneId(m.id)}
                  onPointerLeave={() =>
                    setHoveredMilestoneId((id) => (id === m.id ? null : id))
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    selectMilestone(m.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectMilestone(m.id);
                    }
                  }}
                >
                  <title>{milestoneAria(m)}</title>
                  {isSpan ? (
                    <>
                      <rect
                        className="vbg-custom-milestone-hit"
                        x={Math.min(x0, x1) - 3}
                        y={cy - 8}
                        width={Math.max(8, Math.abs(x1 - x0) + 6)}
                        height={16}
                      />
                      <line
                        className="vbg-custom-milestone-tick-span"
                        x1={x0}
                        x2={x1}
                        y1={cy}
                        y2={cy}
                      />
                      <circle
                        className="vbg-custom-milestone-dot"
                        cx={x0}
                        cy={cy}
                        r={2.5}
                      />
                      <circle
                        className="vbg-custom-milestone-dot"
                        cx={x1}
                        cy={cy}
                        r={2.5}
                      />
                    </>
                  ) : (
                    <g transform={`translate(${midX.toFixed(1)} ${cy})`}>
                      <rect
                        className="vbg-custom-milestone-hit"
                        x={-8}
                        y={-8}
                        width={16}
                        height={16}
                      />
                      <circle className="vbg-custom-milestone-dot" r={3} />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}

      {activeMilestone ? (
        <div
          ref={milestonePopupRef}
          className="vbg-custom-milestone-popup"
          role="dialog"
          aria-label={activeMilestone.label}
          data-placement={milestonePopupPos?.placement}
          style={{
            top: milestonePopupPos?.top ?? 0,
            left: milestonePopupPos?.left ?? 0,
            width: milestonePopupPos?.maxWidth,
            maxHeight: milestonePopupPos?.maxHeight,
            visibility: milestonePopupPos ? "visible" : "hidden",
            pointerEvents: milestonePopupPos ? "auto" : "none",
          }}
          onPointerEnter={() => {
            if (activeMilestone) setHoveredMilestoneId(activeMilestone.id);
          }}
          onPointerLeave={() => {
            if (!selectedId) setHoveredMilestoneId(null);
          }}
        >
          <div className="vbg-custom-milestone-detail-head">
            <div>
              <p className="vbg-stat-label">
                {KIND_SHORT[activeMilestone.kind]}
              </p>
              {personalSelected && onChangePersonal ? (
                <input
                  className="vbg-custom-milestone-title-input"
                  aria-label="Milestone name"
                  value={personalSelected.label}
                  onChange={(e) =>
                    onChangePersonal(personalSelected.id, {
                      label: e.target.value,
                    })
                  }
                />
              ) : (
                <p className="vbg-custom-milestone-detail-title">
                  {activeMilestone.label}
                </p>
              )}
            </div>
            {selectedId ? (
              <button
                type="button"
                className="wealth-row-remove"
                aria-label="Close"
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
            ) : null}
          </div>
          <p className="vbg-meta">
            {milestoneDuration(activeMilestone) > 1
              ? `Ages ${activeMilestone.age}–${
                  activeMilestone.age + milestoneDuration(activeMilestone) - 1
                } · ${activeMilestone.calendarYear}–${
                  activeMilestone.calendarYear +
                  milestoneDuration(activeMilestone) -
                  1
                }`
              : `Age ${activeMilestone.age} · ${activeMilestone.calendarYear}`}
          </p>
          <p className="vbg-meta">{milestoneBody(activeMilestone)}</p>
          {personalSelected &&
          onChangePersonal &&
          onRemovePersonal &&
          typeof currentAge === "number" ? (
            <div className="vbg-custom-milestone-detail-edit">
              <div className="vbg-field">
                <label className="vbg-label" id={`ms-year-${personalSelected.id}`}>
                  Year
                </label>
                <YearSliderPicker
                  ariaLabel="Milestone calendar year"
                  dialogLabel="Choose milestone year"
                  sliderLabel="Year"
                  min={calendarStartYear}
                  max={calendarStartYear + personalHorizon}
                  value={calendarStartYear + personalSelected.yearOffset}
                  onChange={(cal) => {
                    if (cal === null) return;
                    const yearOffset = Math.max(
                      0,
                      Math.min(
                        personalHorizon,
                        Math.round(cal) - calendarStartYear,
                      ),
                    );
                    onChangePersonal(personalSelected.id, { yearOffset });
                  }}
                />
              </div>
              <div className="vbg-field">
                <label
                  className="vbg-label"
                  htmlFor={`ms-age-${personalSelected.id}`}
                >
                  Age
                </label>
                <div className="vbg-unit-field vbg-custom-num">
                  <DeferredNumberInput
                    id={`ms-age-${personalSelected.id}`}
                    inputMode="numeric"
                    value={currentAge + personalSelected.yearOffset}
                    onCommit={(a) => {
                      if (a === null) return;
                      const yearOffset = Math.max(
                        0,
                        Math.min(
                          personalHorizon,
                          Math.round(a) - currentAge,
                        ),
                      );
                      onChangePersonal(personalSelected.id, { yearOffset });
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                className="vbg-button"
                data-variant="ghost"
                onClick={() => {
                  onRemovePersonal(personalSelected.id);
                  setSelectedId(null);
                }}
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {canManagePersonal &&
      personalMilestones &&
      personalMilestones.length > 0 ? (
        <div className="vbg-custom-milestone-rows">
          <div className="vbg-custom-milestone-rows-head" aria-hidden="true">
            <span>Personal</span>
            <span>Year</span>
            <span>Age</span>
            <span />
          </div>
          {personalMilestones.map((m) => {
            const year = calendarStartYear + m.yearOffset;
            const ageAt = (currentAge as number) + m.yearOffset;
            return (
              <div className="vbg-custom-milestone-row" key={m.id}>
                <input
                  aria-label="Milestone name"
                  className="wealth-row-input"
                  value={m.label}
                  placeholder="e.g. Move to FL"
                  onChange={(e) =>
                    onChangePersonal!(m.id, { label: e.target.value })
                  }
                />
                <YearSliderPicker
                  ariaLabel={`Calendar year, age ${ageAt}`}
                  dialogLabel="Choose milestone year"
                  sliderLabel="Year"
                  title={`Age ${ageAt}`}
                  min={calendarStartYear}
                  max={calendarStartYear + personalHorizon}
                  value={year}
                  onChange={(cal) => {
                    if (cal === null) return;
                    const yearOffset = Math.max(
                      0,
                      Math.min(
                        personalHorizon,
                        Math.round(cal) - calendarStartYear,
                      ),
                    );
                    onChangePersonal!(m.id, { yearOffset });
                  }}
                />
                <div className="vbg-unit-field vbg-custom-num">
                  <DeferredNumberInput
                    aria-label={`Age, year ${year}`}
                    inputMode="numeric"
                    value={ageAt}
                    title={`${year}`}
                    onCommit={(a) => {
                      if (a === null) return;
                      const yearOffset = Math.max(
                        0,
                        Math.min(
                          personalHorizon,
                          Math.round(a) - (currentAge as number),
                        ),
                      );
                      onChangePersonal!(m.id, { yearOffset });
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="wealth-row-remove"
                  aria-label={`Remove ${m.label || "milestone"}`}
                  onClick={() => onRemovePersonal!(m.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </figure>
  );
}
