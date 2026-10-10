import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SCENARIO,
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
  potBalance,
  setPotBalance,
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
