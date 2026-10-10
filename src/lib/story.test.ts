import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SCENARIO,
  newAccount,
  project,
  type ScenarioInput,
} from "@/lib/projection";
import {
  BLANK_START_SCENARIO,
  applyRiskStyle,
  buildVerdict,
  buildYearBars,
  currentRiskStyle,
  finalizeStoryScenario,
  lifeEras,
  newIncome,
  newStoryEvent,
  normalize529Links,
  normalizeTimeline,
  setTimeline,
  potBalance,
  setPotBalance,
  logSliderPosition,
  logSliderValue,
} from "@/lib/story";

const YEAR = 2026;

describe("pot balances", () => {
  test("creates an account for an empty bucket", () => {
    const next = setPotBalance(BLANK_START_SCENARIO, "roth", 250_000);
    expect(next.accounts).toHaveLength(1);
    expect(next.accounts[0]!.kind).toBe("roth");
    expect(potBalance(next, "roth")).toBe(250_000);
  });

  test("ignores zero on an empty bucket", () => {
    expect(setPotBalance(BLANK_START_SCENARIO, "taxable", 0)).toBe(
      BLANK_START_SCENARIO,
    );
  });

  test("scales a combined pretax bucket proportionally", () => {
    const base: ScenarioInput = {
      ...BLANK_START_SCENARIO,
      accounts: [
        { ...DEFAULT_SCENARIO.accounts[2]!, id: "a", balance: 300_000 },
        {
          ...DEFAULT_SCENARIO.accounts[2]!,
          id: "b",
          kind: "401k",
          balance: 100_000,
        },
      ],
    };
    const next = setPotBalance(base, "pretax", 800_000);
    expect(next.accounts.map((a) => a.balance)).toEqual([600_000, 200_000]);
    expect(potBalance(next, "pretax")).toBe(800_000);
  });

  test("zero keeps accounts so the slider can come back", () => {
    const next = setPotBalance(DEFAULT_SCENARIO, "taxable", 0);
    expect(potBalance(next, "taxable")).toBe(0);
    const back = setPotBalance(next, "taxable", 100_000);
    expect(potBalance(back, "taxable")).toBe(100_000);
  });
});

describe("finalize", () => {
  test("prunes empty accounts and links 529s to college", () => {
    let s = setPotBalance(BLANK_START_SCENARIO, "education", 40_000);
    s = setPotBalance(s, "roth", 100_000);
    s = setPotBalance(s, "roth", 0);
    const college = newStoryEvent("college", s);
    s = normalize529Links({ ...s, events: [college] });
    const out = finalizeStoryScenario(s);
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0]!.kind).toBe("529");
    expect(out.accounts[0]!.linkedEventId).toBe(college.id);
  });

  test("spreads 529s across colleges before doubling up", () => {
    const base = setPotBalance(
      setPotBalance(BLANK_START_SCENARIO, "education", 10_000),
      "education",
      10_000,
    );
    const second = {
      ...base.accounts[0]!,
      id: "second",
      linkedEventId: null,
    };
    const c1 = newStoryEvent("college", base);
    const c2 = newStoryEvent("college", { ...base, events: [c1] });
    const out = normalize529Links({
      ...base,
      accounts: [{ ...base.accounts[0]!, linkedEventId: null }, second],
      events: [c1, c2],
    });
    expect(out.accounts.map((a) => a.linkedEventId)).toEqual([c1.id, c2.id]);
  });
});

describe("risk style", () => {
  test("applies one fund to every investable account", () => {
    const next = applyRiskStyle(DEFAULT_SCENARIO, "growth");
    expect(currentRiskStyle(next)).toBe("growth");
    expect(
      next.accounts.filter((a) => a.kind === "529").map((a) => a.fund),
    ).toEqual(DEFAULT_SCENARIO.accounts.filter((a) => a.kind === "529").map((a) => a.fund));
  });

  test("returns null for a mixed portfolio", () => {
    expect(currentRiskStyle(DEFAULT_SCENARIO)).toBeNull();
  });
});

describe("presets", () => {
  test("income starts are clamped to the horizon", () => {
    const inc = newIncome("social-security", { age: 70, endAge: 90 });
    expect(inc.startAge).toBe(70);
    expect(newIncome("pension", { age: 50, endAge: 95 }).startAge).toBe(65);
  });

  test("events stay inside the horizon", () => {
    const ev = newStoryEvent("wedding", {
      age: 90,
      endAge: 92,
      events: [],
    });
    expect(ev.startYear).toBeLessThan(2);
  });
});

describe("year bars", () => {
  test("splits need into income-covered and from-savings", () => {
    const s: ScenarioInput = {
      ...DEFAULT_SCENARIO,
      incomes: [
        {
          id: "x",
          label: "Pension",
          annualAmount: 30_000,
          startAge: DEFAULT_SCENARIO.age + 3,
          endAge: null,
          inflates: false,
        },
      ],
    };
    const bars = buildYearBars(s, project(s, YEAR));
    expect(bars[0]!.covered).toBe(0);
    expect(bars[5]!.covered).toBe(30_000);
    for (const b of bars) {
      expect(b.covered + b.fromSavings).toBeCloseTo(b.living + b.events, 6);
    }
  });

  test("still spans the horizon after funds run out", () => {
    const s: ScenarioInput = {
      ...DEFAULT_SCENARIO,
      accounts: DEFAULT_SCENARIO.accounts.slice(0, 1),
      annualSpend: 200_000,
    };
    const rows = project(s, YEAR);
    expect(rows.length).toBeLessThan(s.endAge - s.age + 1);
    const bars = buildYearBars(s, rows);
    expect(bars).toHaveLength(s.endAge - s.age + 1);
    expect(bars[bars.length - 1]!.living).toBeGreaterThan(0);
  });
});

describe("verdict", () => {
  test("reports run-out age for an underfunded plan", () => {
    const s: ScenarioInput = {
      ...DEFAULT_SCENARIO,
      accounts: DEFAULT_SCENARIO.accounts.slice(0, 1),
      annualSpend: 200_000,
    };
    const v = buildVerdict(s, project(s, YEAR));
    expect(v.depleted).toBe(true);
    expect(v.runOutAge).toBeGreaterThan(s.age);
    expect(v.runOutAge).toBeLessThan(s.endAge);
  });

  test("reports a surviving balance for a funded plan", () => {
    const s: ScenarioInput = { ...DEFAULT_SCENARIO, annualSpend: 30_000 };
    const v = buildVerdict(s, project(s, YEAR));
    expect(v.depleted).toBe(false);
    expect(v.endingToday).toBeGreaterThan(0);
    expect(v.yearsOfRunway).toBeGreaterThan(10);
  });
});

describe("life eras", () => {
  test("only returns ages inside the plan", () => {
    const eras = lifeEras({ age: 66, endAge: 80 });
    expect(eras.map((e) => e.id)).toEqual(["social-security", "rmd"]);
  });
});

describe("log slider mapping", () => {
  test("endpoints and monotonic", () => {
    expect(logSliderValue(0, 20_000_000)).toBe(0);
    expect(logSliderValue(1, 20_000_000)).toBe(20_000_000);
    let prev = -1;
    for (let i = 0; i <= 400; i++) {
      const v = logSliderValue(i / 400, 20_000_000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  test("middle of the track is a few hundred thousand, not millions", () => {
    const mid = logSliderValue(0.5, 20_000_000);
    expect(mid).toBeGreaterThan(100_000);
    expect(mid).toBeLessThan(1_000_000);
  });
  test("position inverts value", () => {
    for (const v of [0, 25_000, 240_000, 1_380_000, 20_000_000]) {
      const back = logSliderValue(logSliderPosition(v, 20_000_000), 20_000_000);
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(v * 0.08, 500));
    }
  });
});

describe("integrity fixes", () => {
  const base = { ...DEFAULT_SCENARIO };

  test("setPotBalance keeps the exact total across uneven accounts", () => {
    const withTwo = {
      ...base,
      accounts: [
        { ...newAccount("traditional", base), balance: 333 },
        { ...newAccount("401k", base), balance: 667 },
      ],
    };
    for (const target of [1, 7, 1_001, 123_457]) {
      expect(potBalance(setPotBalance(withTwo, "pretax", target), "pretax")).toBe(
        target,
      );
    }
  });

  test("529 links only target college events, and clear without any", () => {
    const wedding = { ...newStoryEvent("wedding", base), id: "w1" };
    const account = { ...newAccount("529", base), balance: 10_000, linkedEventId: "w1" };
    const noCollege = normalize529Links({ ...base, events: [wedding], accounts: [account] });
    expect(noCollege.accounts[0]!.linkedEventId).toBeNull();

    const college = { ...newStoryEvent("college", base), id: "c1" };
    const relinked = normalize529Links({
      ...base,
      events: [wedding, college],
      accounts: [account],
    });
    expect(relinked.accounts[0]!.linkedEventId).toBe("c1");
  });

  test("timeline changes pull events and income back inside the plan", () => {
    const scenario = {
      ...base,
      age: 50,
      endAge: 95,
      events: [{ ...newStoryEvent("college", base), startYear: 30, durationYears: 10 }],
      incomes: [{ ...newIncome("social-security", base), startAge: 90, endAge: 95 }],
    };
    const shorter = setTimeline(scenario, { endAge: 70 });
    const ev = shorter.events[0]!;
    expect(ev.startYear + ev.durationYears).toBeLessThanOrEqual(20);
    expect(shorter.incomes[0]!.startAge).toBeLessThanOrEqual(70);
    expect(normalizeTimeline({ ...scenario, endAge: 40 }).endAge).toBe(51);
  });

  test("runway ignores 529 balances", () => {
    const scenario = {
      ...base,
      spendMode: "fixed" as const,
      annualSpend: 100_000,
      accounts: [
        { ...newAccount("taxable", base), balance: 500_000 },
        { ...newAccount("529", base), balance: 500_000 },
      ],
    };
    const v = buildVerdict(scenario, []);
    expect(v.yearsOfRunway).toBeCloseTo(5, 5);
  });
});
