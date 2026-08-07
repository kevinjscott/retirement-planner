import {
  deflateToToday,
  fmtMoney,
  project,
  type ScenarioInput,
  type WithdrawOrder,
  type YearRow,
  resolveFederalLtcgRate,
  resolveFederalRate,
} from "@/lib/projection";
import { combinedCapitalGainsRate, combinedPretaxRate } from "@/lib/us-taxes";

export type Insight = {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
};

/** All modeled withdraw orders, in stable UI order. */
export const WITHDRAW_ORDERS: readonly WithdrawOrder[] = [
  "taxable-trad-roth",
  "taxable-roth-trad",
  "pro-rata",
] as const;

/** Compact labels for callouts and the draw-order select. */
export const DRAW_ORDER_LABEL: Record<WithdrawOrder, string> = {
  "taxable-trad-roth": "Tax→Pretax→Roth",
  "taxable-roth-trad": "Tax→Roth→Pretax",
  "pro-rata": "Pro-rata",
};

/** Status circle tone next to the draw-order control. */
export type DrawOrderStatusTone = "best" | "close" | "worse";

/** Relative ending-$ gap under which a suboptimal order counts as "close". */
const CLOSE_ENDING_RATIO = 0.05;

/**
 * Rank draw orders: lasting longer first (later deplete age / no deplete),
 * then higher ending nest egg in today's $.
 */
export const DRAW_ORDER_RANKING_RULE =
  "Rank: longer runway first, then higher ending nest egg in today's $.";

export type DrawOrderOutcome = {
  order: WithdrawOrder;
  label: string;
  /** Ending nest egg deflated to today's dollars. */
  endingToday: number;
  /** Age when funds run out; null if the nest egg lasts through the horizon. */
  depleteAge: number | null;
};

export type DrawOrderComparison = {
  /** Best → worst under {@link DRAW_ORDER_RANKING_RULE}. */
  ranked: DrawOrderOutcome[];
  best: DrawOrderOutcome;
  current: DrawOrderOutcome;
  /** True when current ties for best under the ranking rule. */
  currentIsBest: boolean;
  /**
   * UI tone: unique best → green; tied/near-best → yellow;
   * clearly worse → red.
   */
  status: DrawOrderStatusTone;
  rankingRule: string;
};

function outcomeForOrder(
  scenario: ScenarioInput,
  order: WithdrawOrder,
): DrawOrderOutcome {
  const rows = project({ ...scenario, order });
  const end = rows[rows.length - 1];
  const depleted = rows.find((r) => r.total < 1 && r.year > 0);
  const yearsOut = end?.year ?? 0;
  const endingToday = deflateToToday(
    end?.total ?? 0,
    scenario.inflation,
    yearsOut,
  );
  return {
    order,
    label: DRAW_ORDER_LABEL[order],
    endingToday,
    depleteAge: depleted ? scenario.age + depleted.year : null,
  };
}

/** Runway rank key: null deplete (lasts) sorts above any finite deplete age. */
function runwayKey(o: DrawOrderOutcome): number {
  return o.depleteAge ?? Number.POSITIVE_INFINITY;
}

/**
 * Compare two outcomes: prefer lasting longer, then higher endingToday.
 * Returns negative if `a` is better than `b`.
 */
export function compareDrawOrderOutcomes(
  a: DrawOrderOutcome,
  b: DrawOrderOutcome,
): number {
  // Avoid Infinity - Infinity → NaN (breaks Array.sort when both last).
  const aRunway = runwayKey(a);
  const bRunway = runwayKey(b);
  if (aRunway !== bRunway) return aRunway > bRunway ? -1 : 1;
  if (a.endingToday !== b.endingToday) {
    return a.endingToday > b.endingToday ? -1 : 1;
  }
  return 0;
}

/**
 * Green / yellow / red for the draw-order status control.
 * Yellow covers ties for best and near-misses (same runway ±5% ending, or
 * deplete ages within one year).
 */
export function drawOrderStatusTone(
  comparison: Pick<
    DrawOrderComparison,
    "ranked" | "best" | "current" | "currentIsBest"
  >,
): DrawOrderStatusTone {
  const { current, best, ranked, currentIsBest } = comparison;
  if (currentIsBest) {
    const tieCount = ranked.filter(
      (o) => compareDrawOrderOutcomes(o, best) === 0,
    ).length;
    return tieCount > 1 ? "close" : "best";
  }
  if (runwayKey(current) === runwayKey(best)) {
    const base = Math.max(Math.abs(best.endingToday), 1);
    if (
      Math.abs(best.endingToday - current.endingToday) / base <=
      CLOSE_ENDING_RATIO
    ) {
      return "close";
    }
  }
  if (
    current.depleteAge != null &&
    best.depleteAge != null &&
    Math.abs(current.depleteAge - best.depleteAge) <= 1
  ) {
    return "close";
  }
  return "worse";
}

/**
 * Project the same scenario under every withdraw order and rank by
 * {@link DRAW_ORDER_RANKING_RULE}.
 */
export function compareDrawOrders(
  scenario: ScenarioInput,
): DrawOrderComparison {
  const outcomes = WITHDRAW_ORDERS.map((order) =>
    outcomeForOrder(scenario, order),
  );
  const ranked = [...outcomes].sort(compareDrawOrderOutcomes);
  const best = ranked[0]!;
  const current =
    outcomes.find((o) => o.order === scenario.order) ??
    outcomeForOrder(scenario, scenario.order);
  const currentIsBest = compareDrawOrderOutcomes(current, best) === 0;
  const base = { ranked, best, current, currentIsBest };

  return {
    ...base,
    status: drawOrderStatusTone(base),
    rankingRule: DRAW_ORDER_RANKING_RULE,
  };
}

/** Compact runway cell: deplete age or “to horizon”. */
export function formatDrawOrderRunway(o: DrawOrderOutcome): string {
  return o.depleteAge != null ? `age ${o.depleteAge}` : "to horizon";
}

/**
 * One-line evidence when current order already ranks best:
 * ending today's $ vs next-best, or deplete ages when runway differs.
 */
export function formatBestDrawOrderEvidence(
  comparison: DrawOrderComparison,
): string {
  const { best, ranked } = comparison;
  const next = ranked.find(
    (o) => compareDrawOrderOutcomes(o, best) !== 0,
  );
  if (!next) {
    return `${best.label} ties all orders under this plan.`;
  }
  if (runwayKey(best) !== runwayKey(next)) {
    return `${best.label} lasts to ${formatDrawOrderRunway(best)} vs next-best ${next.label} to ${formatDrawOrderRunway(next)}`;
  }
  return `${best.label} ends at ${fmtMoney(best.endingToday, true)} today's $ vs next-best ${fmtMoney(next.endingToday, true)}`;
}

export function buildInsights(
  scenario: ScenarioInput,
  rows: YearRow[],
): Insight[] {
  const end = rows[rows.length - 1];
  const depleted = rows.find((r) => r.total < 1 && r.year > 0);
  const horizon = Math.max(1, scenario.endAge - scenario.age);

  const collegeTotal = rows.reduce((s, r) => s + r.collegeCost, 0);
  const collegeFrom529 = rows.reduce((s, r) => s + r.eventFrom529, 0);
  const collegeCovered =
    collegeTotal > 0 ? collegeFrom529 / collegeTotal : null;

  const firstIncome = scenario.incomes
    .map((i) => i.startAge)
    .sort((a, b) => a - b)[0];
  const incomeStartsAt = firstIncome != null ? firstIncome : null;

  // Projection totals are nominal; deflate by inflation^years for today's $.
  const yearsOut = end?.year ?? horizon;
  const endingNominal = end?.total ?? 0;
  const endingToday = deflateToToday(
    endingNominal,
    scenario.inflation,
    yearsOut,
  );
  const endAge = end?.age ?? scenario.endAge;

  const insights: Insight[] = [
    {
      id: "ending",
      label: "Ending nest egg in today's $",
      value: fmtMoney(endingToday, true),
      detail: depleted
        ? "Depleted before horizon"
        : `At age ${endAge}, ${yearsOut} year${yearsOut === 1 ? "" : "s"} from now — about ${fmtMoney(endingNominal, true)} at that time`,
      tone: endingToday > 0 ? "ok" : "bad",
    },
  ];

  if (collegeTotal > 0 && collegeCovered != null) {
    insights.push({
      id: "college",
      label: "College covered by 529s",
      value: `${Math.round(collegeCovered * 100)}%`,
      detail: `${fmtMoney(collegeFrom529, true)} 529-funded of ${fmtMoney(collegeTotal, true)} total college costs`,
      tone: collegeCovered >= 0.9 ? "ok" : collegeCovered >= 0.5 ? "warn" : "bad",
    });
  }

  if (incomeStartsAt != null) {
    const streamCount = scenario.incomes.length;
    insights.push({
      id: "income",
      label: "Retirement income starts",
      value: `Age ${incomeStartsAt}`,
      detail: `${streamCount} stream${streamCount === 1 ? "" : "s"}`,
      tone: "neutral",
    });
  }

  return insights;
}

export function buildExportPayload(
  scenario: ScenarioInput,
  rows: YearRow[],
) {
  const end = rows[rows.length - 1];
  const depleted = rows.find((r) => r.total < 1 && r.year > 0);
  const tax = combinedPretaxRate(resolveFederalRate(scenario), scenario.stateCode);
  const cg = combinedCapitalGainsRate(
    resolveFederalLtcgRate(scenario),
    scenario.stateCode,
  );
  const insights = buildInsights(scenario, rows);

  return {
    meta: {
      app: "retirement-scenarios",
      version: 2,
      country: "US",
      exportedAt: new Date().toISOString(),
      purpose:
        "Paste into another LLM to reproduce this retire-now scenario and compare ending balances and withdrawals.",
    },
    assumptions: {
      ...scenario,
      federalRateEstimated: true,
      federalFilingStatusAssumed: "single",
      combinedPretaxRate: tax.combined,
      federalRate: tax.federal,
      stateRateApplied: tax.state,
      combinedCapitalGainsRate: cg.combined,
      federalLtcgRate: cg.federal,
      stateCapitalGainsRate: cg.state,
      taxableCostBasisPct: scenario.taxableCostBasisPct,
      stateNote: tax.stateInfo.note ?? null,
      stateTaxesRetirementDistributions: tax.stateInfo.taxesRetirementDistributions,
    },
    results: {
      startTotal: scenario.accounts.reduce((s, a) => s + a.balance, 0),
      // Nominal terminal portfolio (projection units).
      endingBalance: end?.total ?? 0,
      // Same balance in today's dollars (deflated by inflation^yearsOut).
      endingBalanceToday: deflateToToday(
        end?.total ?? 0,
        scenario.inflation,
        end?.year ?? 0,
      ),
      endingAge: end?.age ?? scenario.endAge,
      yearsOut: end?.year ?? 0,
      depletesAtAge: depleted ? scenario.age + depleted.year : null,
      yearsModeled: rows.length > 0 ? rows[rows.length - 1].year : 0,
      avgAnnualPortfolioWithdrawal:
        rows.length > 0
          ? rows.reduce((s, r) => s + r.withdrawn, 0) / rows.length
          : 0,
      lifetimeEventCost: rows.reduce((s, r) => s + r.eventCost, 0),
      lifetimeCollegeCost: rows.reduce((s, r) => s + r.collegeCost, 0),
      lifetimeCollegeFrom529: rows.reduce((s, r) => s + r.eventFrom529, 0),
      insights,
    },
    yearByYear: rows.map((r) => ({
      year: r.year,
      age: r.age,
      taxable: Math.round(r.taxable),
      retirement: Math.round(r.retirement),
      education529: Math.round(r.education),
      total: Math.round(r.total),
      portfolioWithdrawal: Math.round(r.withdrawn),
      rmd: Math.round(r.rmd),
      eventCost: Math.round(r.eventCost),
      eventFrom529: Math.round(r.eventFrom529),
      collegeCost: Math.round(r.collegeCost),
      living: Math.round(r.living),
      income: Math.round(r.income),
    })),
  };
}
