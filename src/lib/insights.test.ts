import { describe, expect, test } from "bun:test";
import {
  buildExportPayload,
  buildInsights,
  compareDrawOrderOutcomes,
  compareDrawOrders,
  DRAW_ORDER_LABEL,
  formatBestDrawOrderEvidence,
} from "./insights";
import {
  DEFAULT_SCENARIO,
  fmtMoney,
  type ScenarioInput,
  type YearRow,
} from "./projection";

function rows(partial: Array<Partial<YearRow> & Pick<YearRow, "year" | "age" | "total">>): YearRow[] {
  return partial.map((r) => ({
    taxable: 0,
    retirement: r.total,
    roth: 0,
    education: 0,
    withdrawn: 0,
    withdrawnTaxable: 0,
    withdrawnPretax: 0,
    withdrawnRoth: 0,
    rmd: 0,
    eventCost: 0,
    eventFrom529: 0,
    collegeCost: 0,
    living: 0,
    income: 0,
    taxes: 0,
    shortfall: 0,
    liquidTaxable: 0,
    liquidPretax: 0,
    liquidRoth: 0,
    liquidEducation: 0,
    ...r,
  }));
}

describe("buildInsights", () => {
  test("reports ending nest egg in today's dollars vs nominal", () => {
    const scenario = {
      ...DEFAULT_SCENARIO,
      age: 60,
      endAge: 62,
      inflation: 0.1,
      modelTaxes: false,
      incomes: [],
      events: [],
    };
    const projection = rows([
      { year: 0, age: 60, total: 1_000_000 },
      { year: 1, age: 61, total: 1_100_000 },
      { year: 2, age: 62, total: 1_210_000 },
    ]);

    const insights = buildInsights(scenario, projection);
    expect(insights.find((i) => i.id === "runway")).toBeUndefined();
    const ending = insights.find((i) => i.id === "ending");
    expect(ending).toBeDefined();
    expect(ending!.label).toBe("Ending nest egg in today's $");
    const expectedToday = 1_210_000 / Math.pow(1.1, 2);
    expect(ending!.value).toBe(fmtMoney(expectedToday, true));
    expect(ending!.detail).toContain("2 years from now");
    expect(ending!.detail).toContain(fmtMoney(1_210_000, true));
    expect(expectedToday).toBeCloseTo(1_000_000, 5);
  });

  test("yearsOut is 0 when only year-0 row exists", () => {
    const scenario = {
      ...DEFAULT_SCENARIO,
      age: 60,
      endAge: 60,
      inflation: 0.03,
      modelTaxes: false,
      incomes: [],
      events: [],
    };
    const projection = rows([{ year: 0, age: 60, total: 500_000 }]);
    const insights = buildInsights(scenario, projection);
    const ending = insights.find((i) => i.id === "ending")!;
    expect(ending.value).toBe(fmtMoney(500_000, true));
    expect(ending.detail).toContain("0 years from now");
  });
});

describe("compareDrawOrders", () => {
  test("ranks by longer runway first on default depleting fixture", () => {
    // DEFAULT_SCENARIO depletes under all three orders; Tax→Pretax→Roth lasts longest.
    const comparison = compareDrawOrders(DEFAULT_SCENARIO);
    expect(comparison.best.order).toBe("taxable-trad-roth");
    expect(comparison.ranked.map((o) => o.order)).toEqual([
      "taxable-trad-roth",
      "pro-rata",
      "taxable-roth-trad",
    ]);
    expect(comparison.ranked[0]!.depleteAge).toBeGreaterThan(
      comparison.ranked[1]!.depleteAge!,
    );
    expect(comparison.ranked[1]!.depleteAge).toBeGreaterThan(
      comparison.ranked[2]!.depleteAge!,
    );
    expect(comparison.currentIsBest).toBe(true);
    expect(comparison.current.order).toBe(DEFAULT_SCENARIO.order);
    expect(comparison.status).toBe("best");
  });

  test("when all last through horizon, ranks by ending nest egg in today's $", () => {
    const scenario: ScenarioInput = {
      ...DEFAULT_SCENARIO,
      annualSpend: 60_000,
      endAge: 85,
    };
    const comparison = compareDrawOrders(scenario);
    expect(comparison.ranked.every((o) => o.depleteAge === null)).toBe(true);
    expect(comparison.best.order).toBe("taxable-trad-roth");
    expect(comparison.ranked.map((o) => o.order)).toEqual([
      "taxable-trad-roth",
      "pro-rata",
      "taxable-roth-trad",
    ]);
    expect(comparison.ranked[0]!.endingToday).toBeGreaterThan(
      comparison.ranked[1]!.endingToday,
    );
    expect(comparison.ranked[1]!.endingToday).toBeGreaterThan(
      comparison.ranked[2]!.endingToday,
    );
  });

  test("flags current as suboptimal and names the better order", () => {
    const scenario: ScenarioInput = {
      ...DEFAULT_SCENARIO,
      order: "taxable-roth-trad",
    };
    const comparison = compareDrawOrders(scenario);
    expect(comparison.currentIsBest).toBe(false);
    expect(comparison.best.order).toBe("taxable-trad-roth");
    expect(comparison.current.order).toBe("taxable-roth-trad");
    expect(comparison.status).toBe("worse");
    expect(DRAW_ORDER_LABEL[comparison.best.order]).toBe("Tax→Pretax→Roth");
  });

  test("compareDrawOrderOutcomes prefers lasting longer over higher endingToday", () => {
    const lasting = {
      order: "taxable-trad-roth" as const,
      label: "Tax→Pretax→Roth",
      endingToday: 100_000,
      depleteAge: null,
    };
    const earlyRich = {
      order: "taxable-roth-trad" as const,
      label: "Tax→Roth→Pretax",
      endingToday: 500_000,
      depleteAge: 70,
    };
    expect(compareDrawOrderOutcomes(lasting, earlyRich)).toBeLessThan(0);
  });

  test("formatBestDrawOrderEvidence cites runway when that decides the winner", () => {
    const comparison = compareDrawOrders(DEFAULT_SCENARIO);
    const evidence = formatBestDrawOrderEvidence(comparison);
    expect(evidence).toContain("Tax→Pretax→Roth lasts to age");
    expect(evidence).toContain("vs next-best");
  });

  test("formatBestDrawOrderEvidence cites ending today's $ when all last", () => {
    const comparison = compareDrawOrders({
      ...DEFAULT_SCENARIO,
      annualSpend: 60_000,
      endAge: 85,
    });
    const evidence = formatBestDrawOrderEvidence(comparison);
    expect(evidence).toContain("ends at");
    expect(evidence).toContain("today's $");
    expect(evidence).toContain("vs next-best");
  });
});

describe("buildExportPayload", () => {
  test("exposes yearsOut and endingBalanceToday consistently", () => {
    const scenario = {
      ...DEFAULT_SCENARIO,
      age: 60,
      endAge: 63,
      inflation: 0.05,
      modelTaxes: false,
      incomes: [],
      events: [],
      accounts: [
        {
          id: "t1",
          kind: "taxable" as const,
          label: "Brokerage",
          balance: 200_000,
          fund: "cash" as const,
          customReturn: 0,
          linkedEventId: null,
          liquidFromYear: null,
        },
      ],
    };
    const projection = rows([
      { year: 0, age: 60, total: 200_000 },
      { year: 3, age: 63, total: 231_525 },
    ]);
    const payload = buildExportPayload(scenario, projection);
    expect(payload.results.yearsOut).toBe(3);
    expect(payload.results.endingBalance).toBe(231_525);
    expect(payload.results.endingBalanceToday).toBeCloseTo(
      231_525 / Math.pow(1.05, 3),
      2,
    );
  });
});
