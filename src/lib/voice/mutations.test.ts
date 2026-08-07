import { describe, expect, test } from "bun:test";
import { DEFAULT_SCENARIO } from "../projection";
import { createEmptyPointerUiContext } from "./pointer-context";
import { executeVoiceToolCall } from "./execute-tool";
import { VOICE_TOOL } from "./live-tools";
import {
  addAccount,
  batchUpdate,
  removeAccount,
  reorderAccounts,
  summarizeScenario,
  updateAccount,
  updateScenarioScalars,
} from "./mutations";

describe("voice mutations", () => {
  test("update_scenario patches scalars", () => {
    const result = updateScenarioScalars(DEFAULT_SCENARIO, {
      age: 60,
      inflationPct: 2.5,
      modelTaxes: false,
      order: "pro-rata",
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.scenario.age).toBe(60);
    expect(result.scenario.inflation).toBeCloseTo(0.025);
    expect(result.scenario.modelTaxes).toBe(false);
    expect(result.scenario.order).toBe("pro-rata");
  });

  test("update_scenario no-op when values already match", () => {
    const result = updateScenarioScalars(DEFAULT_SCENARIO, {
      age: DEFAULT_SCENARIO.age,
      annualSpend: DEFAULT_SCENARIO.annualSpend,
      inflationPct: Math.round(DEFAULT_SCENARIO.inflation * 10_000) / 100,
      spendMode: DEFAULT_SCENARIO.spendMode,
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.summary).toMatch(/^Already /);
    expect(result.scenario).toBe(DEFAULT_SCENARIO);
  });

  test("update_scenario normalizes money strings without false change", () => {
    const withBalance = {
      ...DEFAULT_SCENARIO,
      annualSpend: 120_000,
    };
    const result = updateScenarioScalars(withBalance, {
      annualSpend: "$120,000",
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.summary).toContain("Already");
  });

  test("update_account no-op when balance already set", () => {
    const acct = DEFAULT_SCENARIO.accounts[0]!;
    const result = updateAccount(DEFAULT_SCENARIO, {
      id: acct.id,
      balance: acct.balance,
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.summary).toMatch(/^Already /);
    expect(result.highlightPaths).toBeUndefined();
  });

  test("add/update/remove account by label", () => {
    const added = addAccount(DEFAULT_SCENARIO, {
      kind: "taxable",
      label: "Joint brokerage",
      balance: 123_000,
      fund: "sp500",
    });
    expect(added.ok).toBe(true);
    expect(added.changed).toBe(true);
    expect(added.scenario.accounts.at(-1)).toMatchObject({
      label: "Joint brokerage",
      balance: 123_000,
      fund: "sp500",
    });

    const updated = updateAccount(added.scenario, {
      matchLabel: "Joint brokerage",
      newLabel: "Taxable joint",
      balance: 150_000,
    });
    expect(updated.ok).toBe(true);
    expect(updated.changed).toBe(true);
    const row = updated.scenario.accounts.find(
      (a) => a.label === "Taxable joint",
    );
    expect(row?.balance).toBe(150_000);

    const removed = removeAccount(updated.scenario, {
      label: "Taxable joint",
    });
    expect(removed.ok).toBe(true);
    expect(
      removed.scenario.accounts.some((a) => a.label === "Taxable joint"),
    ).toBe(false);
  });

  test("reorder_accounts requires full id list", () => {
    const ids = DEFAULT_SCENARIO.accounts.map((a) => a.id);
    const reversed = [...ids].reverse();
    const ok = reorderAccounts(DEFAULT_SCENARIO, { orderedIds: reversed });
    expect(ok.ok).toBe(true);
    expect(ok.changed).toBe(true);
    expect(ok.scenario.accounts.map((a) => a.id)).toEqual(reversed);

    const same = reorderAccounts(DEFAULT_SCENARIO, { orderedIds: ids });
    expect(same.ok).toBe(true);
    expect(same.changed).toBe(false);

    const bad = reorderAccounts(DEFAULT_SCENARIO, {
      orderedIds: ids.slice(0, 1),
    });
    expect(bad.ok).toBe(false);
  });

  test("batch_update applies scalars and account patches once", () => {
    const acct = DEFAULT_SCENARIO.accounts[0]!;
    const other = DEFAULT_SCENARIO.accounts[1]!;
    const result = batchUpdate(DEFAULT_SCENARIO, {
      scenario: { age: 62, annualSpend: 110_000 },
      accounts: [
        { id: acct.id, balance: acct.balance + 1_000 },
        { id: other.id, balance: other.balance },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.scenario.age).toBe(62);
    expect(result.scenario.annualSpend).toBe(110_000);
    expect(
      result.scenario.accounts.find((a) => a.id === acct.id)?.balance,
    ).toBe(acct.balance + 1_000);
    expect(result.changedFields?.length).toBeGreaterThanOrEqual(3);
    expect(result.alreadySet?.some((s) => s.includes("balance"))).toBe(true);
    expect(result.highlightPaths).toEqual(
      expect.arrayContaining([
        "age",
        "annualSpend",
        `accounts.${acct.id}.balance`,
      ]),
    );
    expect(result.highlightPaths).not.toContain(
      `accounts.${other.id}.balance`,
    );
  });

  test("batch_update path/value changes across entities", () => {
    const acct = DEFAULT_SCENARIO.accounts[0]!;
    const result = batchUpdate(DEFAULT_SCENARIO, {
      changes: [
        { path: "age", value: 55 },
        { path: `accounts.${acct.id}.balance`, value: "250000" },
        {
          path: "accounts.x.fund",
          matchLabel: acct.label,
          value: "aggressive",
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.scenario.age).toBe(55);
    expect(
      result.scenario.accounts.find((a) => a.id === acct.id)?.balance,
    ).toBe(250_000);
    expect(
      result.scenario.accounts.find((a) => a.id === acct.id)?.fund,
    ).toBe("aggressive");
    expect(result.highlightPaths).toEqual(
      expect.arrayContaining([
        "age",
        `accounts.${acct.id}.balance`,
        `accounts.${acct.id}.fund`,
      ]),
    );
  });

  test("batch_update all no-ops reports already-set without React apply", () => {
    const acct = DEFAULT_SCENARIO.accounts[0]!;
    const result = batchUpdate(DEFAULT_SCENARIO, {
      scenario: { age: DEFAULT_SCENARIO.age },
      accounts: [{ id: acct.id, balance: acct.balance }],
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.summary).toMatch(/^Already /);
    expect(result.scenario).toBe(DEFAULT_SCENARIO);
    expect(result.highlightPaths).toBeUndefined();
  });
});

describe("voice tool execution reads", () => {
  const emptyUi = createEmptyPointerUiContext();

  test("get_ui_context with no target does not invent first balance", () => {
    const result = executeVoiceToolCall(
      { name: VOICE_TOOL.getUiContext },
      DEFAULT_SCENARIO,
      emptyUi,
    );
    expect(result.response.hasTarget).toBe(false);
    expect(result.response.noTarget).toBeTruthy();
    expect(result.response.focused).toBeNull();
    expect(String(result.response.cue)).toContain("NO TARGET");
    expect(String(result.response.cue)).toContain("first Current Holdings");
  });

  test("no-op mutation does not return scenario for React apply", () => {
    const result = executeVoiceToolCall(
      {
        name: VOICE_TOOL.updateScenario,
        args: { age: DEFAULT_SCENARIO.age },
      },
      DEFAULT_SCENARIO,
      emptyUi,
    );
    expect(result.response.changed).toBe(false);
    expect(result.scenario).toBeUndefined();
    expect(result.highlightPaths).toBeUndefined();
    expect(result.response.summary).toMatch(/^Already /);
  });

  test("get_scenario after update sees new live values", () => {
    const updated = executeVoiceToolCall(
      {
        name: VOICE_TOOL.updateScenario,
        args: { age: 61, annualSpend: "$95,000" },
      },
      DEFAULT_SCENARIO,
      emptyUi,
    );
    expect(updated.response.changed).toBe(true);
    expect(updated.scenario).toBeDefined();
    expect(updated.scenario!.age).toBe(61);
    expect(updated.scenario!.annualSpend).toBe(95_000);

    const read = executeVoiceToolCall(
      { name: VOICE_TOOL.getScenario },
      updated.scenario!,
      emptyUi,
    );
    expect(read.scenario).toBeUndefined();
    expect(read.response.changed).toBe(false);
    const summary = JSON.parse(String(read.response.summary)) as ReturnType<
      typeof summarizeScenario
    >;
    expect(summary.age).toBe(61);
    expect(summary.annualSpend).toBe(95_000);
  });

  test("update_account then get_scenario reflects balance", () => {
    const acct = DEFAULT_SCENARIO.accounts[0]!;
    const nextBal = acct.balance + 12_345;
    const updated = executeVoiceToolCall(
      {
        name: VOICE_TOOL.updateAccount,
        args: { id: acct.id, balance: `$${nextBal.toLocaleString("en-US")}` },
      },
      DEFAULT_SCENARIO,
      emptyUi,
    );
    expect(updated.response.changed).toBe(true);
    expect(updated.scenario?.accounts.find((a) => a.id === acct.id)?.balance).toBe(
      nextBal,
    );

    const read = executeVoiceToolCall(
      { name: VOICE_TOOL.getScenario },
      updated.scenario!,
      emptyUi,
    );
    const summary = JSON.parse(String(read.response.summary)) as {
      accounts: Array<{ id: string; balance: number }>;
    };
    expect(summary.accounts.find((a) => a.id === acct.id)?.balance).toBe(
      nextBal,
    );
  });

  test("batch_update tool returns changedFields and alreadySet", () => {
    const acct = DEFAULT_SCENARIO.accounts[0]!;
    const result = executeVoiceToolCall(
      {
        name: VOICE_TOOL.batchUpdate,
        args: {
          scenario: { age: 63, annualSpend: DEFAULT_SCENARIO.annualSpend },
          accounts: [{ id: acct.id, balance: acct.balance + 50 }],
        },
      },
      DEFAULT_SCENARIO,
      emptyUi,
    );
    expect(result.response.status).toBe("ok");
    expect(result.response.changed).toBe(true);
    expect(result.scenario?.age).toBe(63);
    expect(Array.isArray(result.response.changedFields)).toBe(true);
    expect(Array.isArray(result.response.alreadySet)).toBe(true);
    expect(result.highlightPaths).toEqual(
      expect.arrayContaining(["age", `accounts.${acct.id}.balance`]),
    );
  });
});
