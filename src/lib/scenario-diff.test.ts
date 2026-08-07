import { describe, expect, test } from "bun:test";
import { DEFAULT_SCENARIO, newAccount, uid } from "./projection";
import {
  diffScenarioPaths,
  sameChangedPaths,
  scenariosEqual,
} from "./scenario-diff";

describe("diffScenarioPaths", () => {
  test("returns empty when scenarios match", () => {
    expect(diffScenarioPaths(DEFAULT_SCENARIO, DEFAULT_SCENARIO)).toEqual([]);
    expect(scenariosEqual(DEFAULT_SCENARIO, structuredClone(DEFAULT_SCENARIO))).toBe(
      true,
    );
  });

  test("detects scalar field paths", () => {
    const next = { ...DEFAULT_SCENARIO, age: DEFAULT_SCENARIO.age + 1, order: "pro-rata" as const };
    const paths = diffScenarioPaths(DEFAULT_SCENARIO, next);
    expect(paths).toContain("age");
    expect(paths).toContain("order");
  });

  test("detects account field and row paths", () => {
    const acct = DEFAULT_SCENARIO.accounts[0]!;
    const next = {
      ...DEFAULT_SCENARIO,
      accounts: DEFAULT_SCENARIO.accounts.map((a) =>
        a.id === acct.id ? { ...a, balance: a.balance + 1000 } : a,
      ),
    };
    expect(diffScenarioPaths(DEFAULT_SCENARIO, next)).toEqual([
      `accounts.${acct.id}.balance`,
    ]);

    const added = newAccount("roth", DEFAULT_SCENARIO);
    const withNew = {
      ...DEFAULT_SCENARIO,
      accounts: [...DEFAULT_SCENARIO.accounts, added],
    };
    expect(diffScenarioPaths(DEFAULT_SCENARIO, withNew)).toEqual([
      `accounts.${added.id}`,
    ]);
  });

  test("detects income and event field paths", () => {
    const income = DEFAULT_SCENARIO.incomes[0];
    if (!income) return;
    const nextIncome = {
      ...DEFAULT_SCENARIO,
      incomes: DEFAULT_SCENARIO.incomes.map((i) =>
        i.id === income.id ? { ...i, annualAmount: i.annualAmount + 1 } : i,
      ),
    };
    expect(diffScenarioPaths(DEFAULT_SCENARIO, nextIncome)).toEqual([
      `incomes.${income.id}.annualAmount`,
    ]);

    const event = DEFAULT_SCENARIO.events[0];
    if (!event) return;
    const nextEvent = {
      ...DEFAULT_SCENARIO,
      events: DEFAULT_SCENARIO.events.map((e) =>
        e.id === event.id ? { ...e, annualCost: e.annualCost + 1 } : e,
      ),
    };
    expect(diffScenarioPaths(DEFAULT_SCENARIO, nextEvent)).toEqual([
      `events.${event.id}.annualCost`,
    ]);
  });

  test("detects personal milestone paths", () => {
    const id = uid("milestone");
    const withMs = {
      ...DEFAULT_SCENARIO,
      personalMilestones: [{ id, label: "Trip", yearOffset: 2 }],
    };
    expect(diffScenarioPaths(DEFAULT_SCENARIO, withMs)).toEqual([
      `personalMilestones.${id}`,
    ]);
    const renamed = {
      ...withMs,
      personalMilestones: [{ id, label: "Trip abroad", yearOffset: 2 }],
    };
    expect(diffScenarioPaths(withMs, renamed)).toEqual([
      `personalMilestones.${id}.label`,
    ]);
  });

  test("sameChangedPaths compares as sets", () => {
    expect(sameChangedPaths(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameChangedPaths(["a"], ["a", "b"])).toBe(false);
  });
});
