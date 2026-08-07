import {
  buildExportPayload,
  buildInsights,
  compareDrawOrders,
} from "@/lib/insights";
import {
  buildTimelineMilestones,
  project,
  type ScenarioInput,
  type YearRow,
} from "@/lib/projection";

const CALENDAR_START = new Date().getFullYear();

function roundMoney(n: number): number {
  return Math.round(n);
}

function summarizeYear(r: YearRow, calendarStart: number) {
  return {
    yearOffset: r.year,
    calendarYear: calendarStart + r.year,
    age: r.age,
    total: roundMoney(r.total),
    taxable: roundMoney(r.taxable),
    retirement: roundMoney(r.retirement),
    education529: roundMoney(r.education),
    living: roundMoney(r.living),
    income: roundMoney(r.income),
    taxes: roundMoney(r.taxes),
    shortfall: roundMoney(r.shortfall),
    portfolioWithdrawal: roundMoney(r.withdrawn),
    withdrawnTaxable: roundMoney(r.withdrawnTaxable),
    withdrawnPretax: roundMoney(r.withdrawnPretax),
    withdrawnRoth: roundMoney(r.withdrawnRoth),
    rmd: roundMoney(r.rmd),
    eventCost: roundMoney(r.eventCost),
    eventFrom529: roundMoney(r.eventFrom529),
    collegeCost: roundMoney(r.collegeCost),
  };
}

function findYearRow(
  rows: YearRow[],
  args: {
    calendarYear?: number;
    age?: number;
    yearOffset?: number;
  },
  calendarStart: number,
): YearRow | undefined {
  if (args.yearOffset !== undefined) {
    return rows.find((r) => r.year === Math.round(args.yearOffset!));
  }
  if (args.calendarYear !== undefined) {
    const offset = Math.round(args.calendarYear) - calendarStart;
    return rows.find((r) => r.year === offset);
  }
  if (args.age !== undefined) {
    return rows.find((r) => r.age === Math.round(args.age!));
  }
  return undefined;
}

/**
 * Read-only snapshot of computed UI content: insights, milestones,
 * draw-order comparison, ending/runway numbers, and optional year detail.
 */
export function getPageResults(
  scenario: ScenarioInput,
  args: unknown = {},
): {
  ok: true;
  summary: string;
  data: Record<string, unknown>;
} {
  const calendarStart = CALENDAR_START;
  const rows = project(scenario, calendarStart);
  const insights = buildInsights(scenario, rows);
  const milestones = buildTimelineMilestones(scenario, rows, calendarStart);
  const drawOrders = compareDrawOrders(scenario);
  const exportPayload = buildExportPayload(scenario, rows);

  const record =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  const calendarYear =
    typeof record.calendarYear === "number"
      ? record.calendarYear
      : typeof record.calendarYear === "string"
        ? Number(record.calendarYear)
        : undefined;
  const age =
    typeof record.age === "number"
      ? record.age
      : typeof record.age === "string"
        ? Number(record.age)
        : undefined;
  const yearOffset =
    typeof record.yearOffset === "number"
      ? record.yearOffset
      : typeof record.yearOffset === "string"
        ? Number(record.yearOffset)
        : undefined;
  const includeSeries = record.includeSeries === true;

  const yearFilter = {
    calendarYear: Number.isFinite(calendarYear) ? calendarYear : undefined,
    age: Number.isFinite(age) ? age : undefined,
    yearOffset: Number.isFinite(yearOffset) ? yearOffset : undefined,
  };

  const matched = findYearRow(rows, yearFilter, calendarStart);

  const sections = {
    hero: {
      label: insights.find((i) => i.id === "ending")?.label ?? "Ending nest egg",
      value: insights.find((i) => i.id === "ending")?.value,
      detail: insights.find((i) => i.id === "ending")?.detail,
    },
    insights: insights.map((i) => ({
      id: i.id,
      label: i.label,
      value: i.value,
      detail: i.detail,
      tone: i.tone,
    })),
    milestones: milestones.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      detail: m.detail,
      age: m.age,
      calendarYear: m.calendarYear,
      yearOffset: m.yearOffset,
      durationYears: m.durationYears,
    })),
    drawOrder: {
      current: drawOrders.current,
      best: drawOrders.best,
      currentIsBest: drawOrders.currentIsBest,
      status: drawOrders.status,
      ranked: drawOrders.ranked.map((o) => ({
        order: o.order,
        label: o.label,
        endingToday: Math.round(o.endingToday),
        depleteAge: o.depleteAge,
      })),
    },
    results: exportPayload.results,
    calendarStartYear: calendarStart,
  };

  const data: Record<string, unknown> = { ...sections };

  if (matched) {
    data.year = summarizeYear(matched, calendarStart);
  } else if (
    yearFilter.calendarYear !== undefined ||
    yearFilter.age !== undefined ||
    yearFilter.yearOffset !== undefined
  ) {
    data.year = null;
    data.yearError = "No projection row matches that year/age.";
  }

  if (includeSeries) {
    data.series = rows.map((r) => summarizeYear(r, calendarStart));
  }

  const ending = insights.find((i) => i.id === "ending");
  const summaryParts = [
    ending ? `${ending.label}: ${ending.value}` : null,
    exportPayload.results.depletesAtAge != null
      ? `Depletes at age ${exportPayload.results.depletesAtAge}`
      : "Lasts through horizon",
    matched
      ? `Year ${calendarStart + matched.year} (age ${matched.age}): taxes ${roundMoney(matched.taxes)}, total ${roundMoney(matched.total)}`
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    summary: summaryParts.join(". "),
    data,
  };
}
