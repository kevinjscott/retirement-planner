import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SCENARIO,
  buildTimelineMilestones,
  computeRmd,
  deflateToToday,
  migrateScenario,
  netWorthBreakdown,
  portfolioDrawParts,
  project,
  uniformLifetimeFactor,
  type Account,
  type ScenarioInput,
} from "./projection";

function baseScenario(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    ...DEFAULT_SCENARIO,
    age: 60,
    endAge: 65,
    inflation: 0.1,
    spendMode: "fixed",
    annualSpend: 100_000,
    modelTaxes: false,
    federalRate: 0.22,
    stateCode: "FL",
    accounts: [
      {
        id: "taxable-1",
        kind: "taxable",
        label: "Brokerage",
        balance: 1_000_000,
        fund: "custom",
        customReturn: 0,
        linkedEventId: null,
        liquidFromYear: null,
      },
    ],
    incomes: [],
    events: [],
    personalMilestones: [],
    ...overrides,
  };
}

function cashAccount(
  partial: Pick<Account, "id" | "kind" | "balance"> &
    Partial<Omit<Account, "id" | "kind" | "balance">>,
): Account {
  return {
    label: partial.label ?? partial.kind,
    fund: "custom",
    customReturn: 0,
    linkedEventId: null,
    liquidFromYear: null,
    ...partial,
  };
}

describe("netWorthBreakdown", () => {
  test("sums total and buckets by liquid fund then kind", () => {
    const { total, buckets } = netWorthBreakdown([
      cashAccount({ id: "t1", kind: "taxable", balance: 100_000 }),
      cashAccount({
        id: "cash-1",
        kind: "taxable",
        balance: 25_000,
        fund: "checking",
      }),
      cashAccount({ id: "roth-1", kind: "roth", balance: 50_000 }),
      cashAccount({ id: "trad-1", kind: "traditional", balance: 75_000 }),
      cashAccount({ id: "529-1", kind: "529", balance: 40_000 }),
    ]);
    expect(total).toBe(290_000);
    expect(buckets.map((b) => [b.id, b.amount])).toEqual([
      ["cash", 25_000],
      ["taxable", 100_000],
      ["retirement", 125_000],
      ["education", 40_000],
    ]);
  });

  test("omits zero buckets", () => {
    const { buckets } = netWorthBreakdown([
      cashAccount({ id: "roth-1", kind: "roth", balance: 10_000 }),
    ]);
    expect(buckets).toEqual([
      { id: "retirement", label: "Retirement", amount: 10_000 },
    ]);
  });
});

describe("project", () => {
  test("inflates living spend each year", () => {
    const rows = project(baseScenario({ annualSpend: 100_000, inflation: 0.1 }));
    expect(rows[0]!.living).toBeCloseTo(100_000, 0);
    expect(rows[1]!.living).toBeCloseTo(110_000, 0);
    expect(rows[2]!.living).toBeCloseTo(121_000, 0);
  });

  test("taxable-only draw leaves pretax and Roth withdrawn near zero", () => {
    const rows = project(
      baseScenario({
        age: 60,
        endAge: 62,
        inflation: 0,
        annualSpend: 50_000,
        modelTaxes: false,
        order: "taxable-trad-roth",
        accounts: [
          cashAccount({ id: "taxable-1", kind: "taxable", balance: 500_000 }),
          cashAccount({ id: "trad-1", kind: "traditional", balance: 400_000 }),
          cashAccount({ id: "roth-1", kind: "roth", balance: 200_000 }),
        ],
      }),
    );
    const y0 = rows[0]!;
    expect(y0.withdrawnTaxable).toBeCloseTo(50_000, 0);
    expect(y0.withdrawnPretax).toBeCloseTo(0, 0);
    expect(y0.withdrawnRoth).toBeCloseTo(0, 0);
    expect(y0.withdrawn).toBeCloseTo(50_000, 0);
  });

  test("charges inflated event costs only during the event window", () => {
    const rows = project(
      baseScenario({
        annualSpend: 0,
        inflation: 0.1,
        events: [
          {
            id: "wedding",
            kind: "wedding",
            label: "Wedding",
            startYear: 1,
            durationYears: 1,
            annualCost: 50_000,
          },
        ],
      }),
    );
    expect(rows[0]!.eventCost).toBe(0);
    expect(rows[1]!.eventCost).toBeCloseTo(55_000, 0);
    expect(rows[2]!.eventCost).toBe(0);
  });

  test("linked 529 pays college before portfolio draw", () => {
    const rows = project(
      baseScenario({
        annualSpend: 0,
        inflation: 0,
        endAge: 64,
        accounts: [
          cashAccount({ id: "taxable-1", kind: "taxable", balance: 500_000 }),
          cashAccount({
            id: "529-1",
            kind: "529",
            balance: 80_000,
            linkedEventId: "kid-1",
          }),
        ],
        events: [
          {
            id: "kid-1",
            kind: "college",
            label: "Kid college",
            startYear: 1,
            durationYears: 2,
            annualCost: 40_000,
          },
        ],
      }),
    );

    const collegeYears = rows.filter((r) => r.collegeCost > 0);
    expect(collegeYears).toHaveLength(2);
    expect(collegeYears[0]!.eventFrom529).toBeCloseTo(40_000, 0);
    expect(collegeYears[0]!.withdrawn).toBeCloseTo(0, 0);
    expect(collegeYears[1]!.eventFrom529).toBeCloseTo(40_000, 0);
    expect(collegeYears[1]!.withdrawn).toBeCloseTo(0, 0);
  });

  test("empty accounts produce zero totals and deplete after year 0", () => {
    const rows = project(
      baseScenario({
        accounts: [],
        annualSpend: 50_000,
        endAge: 63,
      }),
    );
    expect(rows[0]!.total).toBe(0);
    expect(rows.length).toBe(2);
    expect(rows[1]!.total).toBe(0);
  });

  test("does not invent work income — only retirement streams at startAge", () => {
    const rows = project(
      baseScenario({
        age: 60,
        endAge: 68,
        annualSpend: 0,
        inflation: 0,
        accounts: [
          cashAccount({ id: "taxable-1", kind: "taxable", balance: 100_000 }),
        ],
        incomes: [
          {
            id: "ss-1",
            label: "Social Security",
            annualAmount: 24_000,
            startAge: 67,
            endAge: null,
            inflates: false,
          },
        ],
      }),
    );

    const beforeSs = rows.filter((r) => r.age < 67);
    const atSs = rows.find((r) => r.age === 67);
    expect(beforeSs.every((r) => r.income === 0)).toBe(true);
    expect(atSs?.income).toBe(24_000);
  });
});

describe("migrateScenario", () => {
  test("migrates legacy colleges into events", () => {
    const scenario = migrateScenario({
      age: 55,
      colleges: [
        {
          id: "c1",
          label: "Kid college",
          startYear: 3,
          durationYears: 4,
          annualCost: 40_000,
        },
      ],
      accounts: [],
      incomes: [],
    });
    expect(scenario.events).toHaveLength(1);
    expect(scenario.events[0]).toMatchObject({
      id: "c1",
      kind: "college",
      label: "Kid college",
      startYear: 3,
      durationYears: 4,
      annualCost: 40_000,
    });
  });

  test("strips legacy work fields from the migrated scenario", () => {
    const scenario = migrateScenario({
      age: 50,
      workSalary: 200_000,
      workRaise: 0.03,
      workEndAge: 65,
      workIncomes: [{ id: "w1", annualAmount: 100_000 }],
      accounts: [],
      incomes: [],
      events: [],
    });
    const asRecord = scenario as unknown as Record<string, unknown>;
    expect(asRecord.workSalary).toBeUndefined();
    expect(asRecord.workRaise).toBeUndefined();
    expect(asRecord.workEndAge).toBeUndefined();
    expect(asRecord.workIncomes).toBeUndefined();
    expect(scenario.incomes).toEqual([]);
  });

  test("defaults missing liquidFromYear to null (liquid now)", () => {
    const scenario = migrateScenario({
      age: 55,
      accounts: [
        {
          id: "trad-1",
          kind: "traditional",
          label: "Trad",
          balance: 100_000,
          fund: "moderate",
          customReturn: 0.07,
          linkedEventId: null,
        },
      ],
      incomes: [],
      events: [],
    });
    expect(scenario.accounts[0]!.liquidFromYear).toBeNull();
  });

  test("preserves liquidFromYear when present", () => {
    const scenario = migrateScenario({
      age: 55,
      accounts: [
        {
          id: "trad-1",
          kind: "traditional",
          label: "Trad",
          balance: 100_000,
          fund: "moderate",
          customReturn: 0.07,
          linkedEventId: null,
          liquidFromYear: 2031,
        },
      ],
      incomes: [],
      events: [],
    });
    expect(scenario.accounts[0]!.liquidFromYear).toBe(2031);
  });
});

describe("deflateToToday", () => {
  test("leaves year-0 amounts unchanged", () => {
    expect(deflateToToday(1_000_000, 0.03, 0)).toBe(1_000_000);
  });

  test("deflates by (1+inflation)^yearOffset", () => {
    expect(deflateToToday(1_210_000, 0.1, 2)).toBeCloseTo(1_000_000, 5);
    expect(deflateToToday(231_525, 0.05, 3)).toBeCloseTo(
      231_525 / Math.pow(1.05, 3),
      5,
    );
  });

  test("skips deflation when inflation is 0", () => {
    expect(deflateToToday(500_000, 0, 10)).toBe(500_000);
  });
});

describe("RMD", () => {
  test("computeRmd is zero before age 73 and uses Uniform Lifetime at 73", () => {
    expect(computeRmd(265_000, 72)).toBe(0);
    expect(computeRmd(265_000, 73)).toBeCloseTo(10_000, 5);
    expect(uniformLifetimeFactor(73)).toBe(26.5);
  });

  test("no RMD withdrawals before age 73", () => {
    const rows = project(
      baseScenario({
        age: 70,
        endAge: 72,
        inflation: 0,
        annualSpend: 0,
        accounts: [
          cashAccount({ id: "trad-1", kind: "traditional", balance: 265_000 }),
        ],
      }),
    );
    expect(rows.every((r) => r.rmd === 0)).toBe(true);
    expect(rows[rows.length - 1]!.retirement).toBeCloseTo(265_000, 0);
  });

  test("RMD forces pretax withdrawal even when spend need is zero", () => {
    const rows = project(
      baseScenario({
        age: 73,
        endAge: 74,
        inflation: 0,
        annualSpend: 0,
        modelTaxes: false,
        accounts: [
          cashAccount({ id: "taxable-1", kind: "taxable", balance: 0 }),
          cashAccount({ id: "trad-1", kind: "traditional", balance: 265_000 }),
        ],
      }),
    );
    const y0 = rows[0]!;
    expect(y0.rmd).toBeCloseTo(10_000, 0);
    // Excess RMD (no spend) lands in taxable; pretax shrinks.
    expect(y0.taxable).toBeCloseTo(10_000, 0);
    expect(y0.retirement).toBeCloseTo(255_000, 0);
    expect(y0.withdrawn).toBeCloseTo(0, 0);
    // Full RMD still counts as pretax outflow (excess rolled to taxable).
    expect(y0.withdrawnPretax).toBeCloseTo(10_000, 0);
    expect(y0.withdrawnTaxable).toBeCloseTo(0, 0);
    expect(y0.withdrawnRoth).toBeCloseTo(0, 0);
  });

  test("RMD excess above spend need moves to taxable brokerage", () => {
    const rows = project(
      baseScenario({
        age: 73,
        endAge: 74,
        inflation: 0,
        annualSpend: 4_000,
        modelTaxes: false,
        order: "taxable-trad-roth",
        accounts: [
          cashAccount({ id: "taxable-1", kind: "taxable", balance: 0 }),
          cashAccount({ id: "trad-1", kind: "traditional", balance: 265_000 }),
        ],
      }),
    );
    const y0 = rows[0]!;
    expect(y0.rmd).toBeCloseTo(10_000, 0);
    // $4k funds spend; $6k excess → taxable.
    expect(y0.withdrawn).toBeCloseTo(4_000, 0);
    expect(y0.withdrawnPretax).toBeCloseTo(10_000, 0);
    expect(y0.taxable).toBeCloseTo(6_000, 0);
    expect(y0.retirement).toBeCloseTo(255_000, 0);
  });

  test("RMD still taken from pretax when income covers lifestyle", () => {
    const rows = project(
      baseScenario({
        age: 73,
        endAge: 74,
        inflation: 0,
        annualSpend: 50_000,
        modelTaxes: false,
        accounts: [
          cashAccount({ id: "taxable-1", kind: "taxable", balance: 100_000 }),
          cashAccount({ id: "trad-1", kind: "traditional", balance: 265_000 }),
        ],
        incomes: [
          {
            id: "pension",
            label: "Pension",
            annualAmount: 50_000,
            startAge: 73,
            endAge: null,
            inflates: false,
          },
        ],
      }),
    );
    const y0 = rows[0]!;
    expect(y0.income).toBe(50_000);
    expect(y0.rmd).toBeCloseTo(10_000, 0);
    expect(y0.taxable).toBeCloseTo(110_000, 0);
    expect(y0.retirement).toBeCloseTo(255_000, 0);
  });

  test("milestone detail includes first-year RMD amount in today's $", () => {
    const scenario = baseScenario({
      age: 72,
      endAge: 75,
      inflation: 0,
      annualSpend: 0,
      modelTaxes: false,
      accounts: [
        cashAccount({ id: "trad-1", kind: "traditional", balance: 265_000 }),
      ],
    });
    const rows = project(scenario);
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const rmd = milestones.find((m) => m.kind === "rmd");
    expect(rmd).toBeDefined();
    expect(rmd!.detail).toContain("$10k");
    expect(rmd!.detail).toContain("today's $");
    expect(rmd!.detail).toContain("From age 73");
    expect(rmd!.detail).toContain("must take");
  });

  test("milestone notes when Trad/401k are already drawn down by RMD age", () => {
    const scenario = baseScenario({
      age: 72,
      endAge: 74,
      inflation: 0,
      annualSpend: 300_000,
      modelTaxes: false,
      order: "taxable-trad-roth",
      accounts: [
        cashAccount({ id: "trad-1", kind: "traditional", balance: 50_000 }),
        cashAccount({ id: "roth-1", kind: "roth", balance: 800_000 }),
      ],
    });
    const rows = project(scenario);
    expect(rows.find((r) => r.age === 73)?.rmd ?? -1).toBe(0);
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const rmd = milestones.find((m) => m.kind === "rmd");
    expect(rmd).toBeDefined();
    expect(rmd!.detail).toContain("No Trad/401(k) left");
    expect(rmd!.detail).toContain("Roth has no RMD");
  });
});

describe("bucket depletion milestones", () => {
  test("marks taxable depleted when brokerage hits ~$0 with retirement left", () => {
    const scenario = baseScenario({
      age: 60,
      endAge: 70,
      inflation: 0,
      annualSpend: 100_000,
      modelTaxes: false,
      order: "taxable-trad-roth",
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 200_000 }),
        cashAccount({ id: "trad-1", kind: "traditional", balance: 500_000 }),
      ],
    });
    const rows = project(scenario);
    const firstEmpty = rows.find((r) => r.taxable < 1 && r.retirement >= 1);
    expect(firstEmpty).toBeDefined();
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const taxable = milestones.find((m) => m.id === "bucket-taxable");
    expect(taxable).toBeDefined();
    expect(taxable!.kind).toBe("bucket");
    expect(taxable!.label).toBe("Taxable depleted");
    expect(taxable!.yearOffset).toBe(firstEmpty!.year);
    expect(taxable!.detail).toContain("Taxable hits $0");
    expect(taxable!.detail).toContain("further spending draws from");
    expect(taxable!.detail).toContain("pretax/Roth");
    expect(taxable!.detail).toContain("gross-up is off");
    expect(taxable!.detail).toContain("Living that year");
  });

  test("marks 529 depleted when education hits ~$0 with other funds left", () => {
    const scenario = baseScenario({
      age: 50,
      endAge: 60,
      inflation: 0,
      annualSpend: 0,
      modelTaxes: false,
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 300_000 }),
        cashAccount({
          id: "529-1",
          kind: "529",
          balance: 80_000,
          linkedEventId: "college-1",
        }),
      ],
      events: [
        {
          id: "college-1",
          kind: "college",
          label: "College",
          startYear: 0,
          durationYears: 4,
          annualCost: 40_000,
        },
      ],
    });
    const rows = project(scenario);
    const firstEmpty = rows.find(
      (r) => r.education < 1 && r.taxable + r.retirement >= 1,
    );
    expect(firstEmpty).toBeDefined();
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const edu = milestones.find((m) => m.id === "bucket-529");
    expect(edu).toBeDefined();
    expect(edu!.label).toBe("529 depleted");
    expect(edu!.yearOffset).toBe(firstEmpty!.year);
  });

  test("does not mark taxable depleted when starting taxable is already zero", () => {
    const scenario = baseScenario({
      age: 60,
      endAge: 65,
      inflation: 0,
      annualSpend: 50_000,
      modelTaxes: false,
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 0 }),
        cashAccount({ id: "trad-1", kind: "traditional", balance: 400_000 }),
      ],
    });
    const rows = project(scenario);
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    expect(milestones.find((m) => m.id === "bucket-taxable")).toBeUndefined();
  });
});

describe("life-stage and draw milestones", () => {
  test("marks Pretax unlock (59½) and Medicare when in horizon with retirement accounts", () => {
    const scenario = baseScenario({
      age: 55,
      endAge: 70,
      inflation: 0,
      annualSpend: 10_000,
      modelTaxes: false,
      accounts: [
        cashAccount({ id: "trad-1", kind: "traditional", balance: 500_000 }),
      ],
    });
    const rows = project(scenario, 2026);
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const half = milestones.find((m) => m.id === "life-59-5");
    expect(half).toBeDefined();
    expect(half!.kind).toBe("life");
    expect(half!.label).toBe("Pretax unlock (59½)");
    expect(half!.age).toBe(59);
    expect(half!.detail).toContain("before 59½");
    expect(half!.detail).toContain("early-withdrawal penalty");
    expect(half!.detail).toContain("bridged from liquid taxable");
    expect(half!.detail).toContain("turn tax estimate on");
    const medicare = milestones.find((m) => m.id === "life-medicare");
    expect(medicare).toBeDefined();
    expect(medicare!.label).toBe("Medicare starts");
    expect(medicare!.age).toBe(65);
    expect(medicare!.detail).toContain("Medicare eligibility typically starts");
    expect(medicare!.detail).toContain("fold Part B/D");
  });

  test("Pretax unlock notes when pretax draws start after penalty-free age", () => {
    const scenario = baseScenario({
      age: 55,
      endAge: 70,
      inflation: 0,
      annualSpend: 40_000,
      modelTaxes: false,
      order: "taxable-trad-roth",
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 400_000 }),
        cashAccount({ id: "trad-1", kind: "traditional", balance: 500_000 }),
      ],
    });
    const rows = project(scenario, 2026);
    const firstPretax = rows.find((r) => r.withdrawnPretax > 1);
    expect(firstPretax).toBeDefined();
    expect(firstPretax!.age).toBeGreaterThan(59);
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const half = milestones.find((m) => m.id === "life-59-5");
    expect(half).toBeDefined();
    expect(half!.detail).toContain("after 59½");
    expect(half!.detail).toContain("never applies");
    expect(half!.detail).toContain(`until age ${firstPretax!.age}`);
  });

  test("Pretax unlock notes when plan has no pretax accounts", () => {
    const scenario = baseScenario({
      age: 55,
      endAge: 70,
      inflation: 0,
      annualSpend: 10_000,
      modelTaxes: false,
      accounts: [
        cashAccount({ id: "roth-1", kind: "roth", balance: 500_000 }),
      ],
    });
    const rows = project(scenario, 2026);
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const half = milestones.find((m) => m.id === "life-59-5");
    expect(half).toBeDefined();
    expect(half!.detail).toContain("No Trad/401(k) in the plan");
    expect(half!.detail).toContain("doesn't change withdrawals");
  });

  test("marks first pretax draw when Trad is tapped before RMD", () => {
    const scenario = baseScenario({
      age: 60,
      endAge: 70,
      inflation: 0,
      annualSpend: 100_000,
      modelTaxes: false,
      order: "taxable-trad-roth",
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 150_000 }),
        cashAccount({ id: "trad-1", kind: "traditional", balance: 500_000 }),
      ],
    });
    const rows = project(scenario, 2026);
    const firstPretax = rows.find((r) => r.withdrawnPretax > 1);
    expect(firstPretax).toBeDefined();
    expect(firstPretax!.age).toBeLessThan(73);
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const draw = milestones.find((m) => m.id === "draw-pretax");
    expect(draw).toBeDefined();
    expect(draw!.kind).toBe("draw");
    expect(draw!.label).toBe("First draw from pretax accounts");
    expect(draw!.yearOffset).toBe(firstPretax!.year);
    expect(draw!.detail).toContain("today's $");
    expect(draw!.detail).toContain("You open Trad/401(k)");
    expect(draw!.detail).toContain("After 59½");
    expect(draw!.detail).toContain("Taxable→Pretax→Roth");
  });

  test("marks Roth depleted when Roth hits ~$0 with other money left", () => {
    const scenario = baseScenario({
      age: 60,
      endAge: 75,
      inflation: 0,
      annualSpend: 80_000,
      modelTaxes: false,
      order: "taxable-roth-trad",
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 50_000 }),
        cashAccount({ id: "roth-1", kind: "roth", balance: 120_000 }),
        cashAccount({ id: "trad-1", kind: "traditional", balance: 400_000 }),
      ],
    });
    const rows = project(scenario, 2026);
    const firstEmpty = rows.find(
      (r) =>
        r.roth < 1 &&
        r.taxable + (r.retirement - r.roth) + r.education >= 1,
    );
    expect(firstEmpty).toBeDefined();
    const milestones = buildTimelineMilestones(scenario, rows, 2026);
    const roth = milestones.find((m) => m.id === "bucket-roth");
    expect(roth).toBeDefined();
    expect(roth!.label).toBe("Roth depleted");
    expect(roth!.yearOffset).toBe(firstEmpty!.year);
  });

});

describe("account liquidity locks", () => {
  test("skips accounts until liquidFromYear calendar unlock", () => {
    const cal = 2026;
    const scenario = baseScenario({
      age: 55,
      endAge: 60,
      inflation: 0,
      annualSpend: 50_000,
      modelTaxes: false,
      order: "taxable-trad-roth",
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 200_000 }),
        cashAccount({
          id: "trad-1",
          kind: "traditional",
          balance: 500_000,
          liquidFromYear: 2030, // unlock at age 59
        }),
      ],
    });
    const rows = project(scenario, cal);
    const before = rows.filter((r) => cal + r.year < 2030);
    expect(before.length).toBeGreaterThan(0);
    for (const row of before) {
      expect(row.withdrawnPretax).toBe(0);
    }
    const unlockRow = rows.find((r) => cal + r.year === 2030);
    expect(unlockRow).toBeDefined();
    // Taxable may still cover spend at unlock; force a later year if needed.
    const pretaxDraw = rows.find((r) => r.withdrawnPretax > 1);
    expect(pretaxDraw).toBeDefined();
    expect(cal + pretaxDraw!.year).toBeGreaterThanOrEqual(2030);
  });

  test("splits liquid vs illiquid balances by liquidFromYear", () => {
    const cal = 2026;
    const scenario = baseScenario({
      age: 55,
      endAge: 62,
      inflation: 0,
      annualSpend: 0,
      modelTaxes: false,
      accounts: [
        cashAccount({ id: "taxable-open", kind: "taxable", balance: 100_000 }),
        cashAccount({
          id: "taxable-lock",
          kind: "taxable",
          balance: 40_000,
          liquidFromYear: 2030,
        }),
        cashAccount({
          id: "trad-lock",
          kind: "traditional",
          balance: 200_000,
          liquidFromYear: 2030,
        }),
        cashAccount({ id: "roth-open", kind: "roth", balance: 50_000 }),
        cashAccount({
          id: "edu-lock",
          kind: "529",
          balance: 30_000,
          liquidFromYear: 2031,
        }),
      ],
    });
    const rows = project(scenario, cal);
    const y0 = rows[0]!;
    expect(y0.taxable).toBeCloseTo(140_000, 0);
    expect(y0.liquidTaxable).toBeCloseTo(100_000, 0);
    expect(y0.liquidPretax).toBe(0);
    expect(Math.max(0, y0.retirement - y0.roth)).toBeCloseTo(200_000, 0);
    expect(y0.liquidRoth).toBeCloseTo(50_000, 0);
    expect(y0.roth).toBeCloseTo(50_000, 0);
    expect(y0.liquidEducation).toBe(0);
    expect(y0.education).toBeCloseTo(30_000, 0);

    const unlock2030 = rows.find((r) => cal + r.year === 2030)!;
    expect(unlock2030.liquidTaxable).toBeCloseTo(unlock2030.taxable, 0);
    expect(unlock2030.liquidPretax).toBeCloseTo(
      Math.max(0, unlock2030.retirement - unlock2030.roth),
      0,
    );
    expect(unlock2030.liquidEducation).toBe(0);

    const unlock2031 = rows.find((r) => cal + r.year === 2031)!;
    expect(unlock2031.liquidEducation).toBeCloseTo(unlock2031.education, 0);
  });

  test("records shortfall when only illiquid balances remain", () => {
    const cal = 2026;
    const scenario = baseScenario({
      age: 55,
      endAge: 58,
      inflation: 0,
      annualSpend: 80_000,
      modelTaxes: false,
      order: "taxable-trad-roth",
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 100_000 }),
        cashAccount({
          id: "trad-1",
          kind: "traditional",
          balance: 1_000_000,
          liquidFromYear: 2035,
        }),
      ],
    });
    const rows = project(scenario, cal);
    const short = rows.find((r) => r.shortfall > 1);
    expect(short).toBeDefined();
    expect(short!.withdrawnPretax).toBe(0);
    expect(short!.shortfall).toBeGreaterThan(0);
    // Illiquid pretax still sits on the books.
    expect(short!.retirement).toBeGreaterThan(900_000);
    const milestones = buildTimelineMilestones(scenario, rows, cal);
    const pinch = milestones.find((m) => m.id === "pinch-shortfall");
    expect(pinch).toBeDefined();
    expect(pinch!.kind).toBe("pinch");
    expect(pinch!.label).toBe("Cash-flow shortfall");
  });

  test("marks taxable bridge pinch when liquid taxable depletes before 59½", () => {
    const cal = 2026;
    const scenario = baseScenario({
      age: 55,
      endAge: 65,
      inflation: 0,
      annualSpend: 100_000,
      modelTaxes: false,
      order: "taxable-trad-roth",
      accounts: [
        cashAccount({ id: "taxable-1", kind: "taxable", balance: 150_000 }),
        cashAccount({ id: "trad-1", kind: "traditional", balance: 800_000 }),
      ],
    });
    const rows = project(scenario, cal);
    const liquidGone = rows.find(
      (r) => r.liquidTaxable < 1 && r.age < 59 && r.retirement > 1,
    );
    expect(liquidGone).toBeDefined();
    const milestones = buildTimelineMilestones(scenario, rows, cal);
    const bridge = milestones.find((m) => m.id === "pinch-bridge-59-5");
    expect(bridge).toBeDefined();
    expect(bridge!.kind).toBe("pinch");
    expect(bridge!.label).toBe("Taxable bridge pinch");
    expect(bridge!.detail).toContain("before pretax unlock at 59½");
    expect(bridge!.durationYears).toBeGreaterThan(1);
    const half = milestones.find((m) => m.id === "life-59-5");
    expect(half!.label).toBe("Pretax unlock (59½)");
  });
});

describe("portfolioDrawParts", () => {
  test("splits living, event shortfall, and implied tax gross-up", () => {
    const parts = portfolioDrawParts({
      year: 5,
      age: 63,
      taxable: 0,
      retirement: 1_000_000,
      roth: 400_000,
      education: 0,
      total: 1_000_000,
      living: 100_000,
      eventCost: 80_000,
      eventFrom529: 40_000,
      collegeCost: 80_000,
      income: 10_000,
      withdrawn: 200_000,
      withdrawnTaxable: 0,
      withdrawnPretax: 200_000,
      withdrawnRoth: 0,
      rmd: 0,
      taxes: 70_000,
      shortfall: 0,
      liquidTaxable: 0,
      liquidPretax: 600_000,
      liquidRoth: 400_000,
      liquidEducation: 0,
    });
    expect(parts.eventShortfall).toBe(40_000);
    expect(parts.netNeed).toBe(130_000); // 100k + 40k - 10k
    expect(parts.taxGrossUp).toBe(70_000);
  });
});

describe("taxable capital gains gross-up", () => {
  test("grosses up taxable draws when modelTaxes is on", () => {
    // 50% basis → 50% gain; 15% federal LTCG (FL has no state CG)
    // effective rate on withdrawal = 0.5 * 0.15 = 0.075
    // need 100k → gross ≈ 100k / 0.925 ≈ 108_108
    const rows = project(
      baseScenario({
        age: 60,
        endAge: 61,
        inflation: 0,
        annualSpend: 100_000,
        modelTaxes: true,
        stateCode: "FL",
        taxableCostBasisPct: 0.5,
        order: "taxable-trad-roth",
        accounts: [
          cashAccount({
            id: "taxable-1",
            kind: "taxable",
            balance: 500_000,
            fund: "moderate",
          }),
        ],
        incomes: [],
        events: [],
      }),
    );
    const y0 = rows[0]!;
    expect(y0.withdrawnTaxable).toBeGreaterThan(100_000);
    expect(y0.taxes).toBeGreaterThan(0);
    expect(y0.taxes).toBeCloseTo(y0.withdrawnTaxable - 100_000, 0);
    // Net after tax ≈ spend need
    expect(y0.withdrawnTaxable - y0.taxes).toBeCloseTo(100_000, 0);
  });

  test("checking/cash taxable funds are not CG-grossed up", () => {
    const rows = project(
      baseScenario({
        age: 60,
        endAge: 61,
        inflation: 0,
        annualSpend: 50_000,
        modelTaxes: true,
        stateCode: "FL",
        taxableCostBasisPct: 0.5,
        order: "taxable-trad-roth",
        accounts: [
          cashAccount({
            id: "cash-1",
            kind: "taxable",
            balance: 200_000,
            fund: "checking",
          }),
        ],
        incomes: [],
        events: [],
      }),
    );
    const y0 = rows[0]!;
    expect(y0.withdrawnTaxable).toBeCloseTo(50_000, 0);
    expect(y0.taxes).toBeCloseTo(0, 0);
  });

  test("migrateScenario defaults taxableCostBasisPct to 0.5", () => {
    const scenario = migrateScenario({
      age: 55,
      accounts: [],
      incomes: [],
      events: [],
    });
    expect(scenario.taxableCostBasisPct).toBe(0.5);
  });
});
