import { describe, expect, test } from "bun:test";
import {
  analyzeImportItems,
  applyImportItems,
  chunkImportSourceText,
  IMPORT_COMPLETENESS_RULES,
  IMPORT_LATE_CONTENT_FIXTURE,
  IMPORT_LATE_CONTENT_LABELS,
  IMPORT_SYSTEM_PROMPT,
  IMPORT_TEXT_CHAR_LIMIT,
  isContextLengthError,
  mapInvestmentHintToFund,
  mergeImportExtractionList,
  mergeImportExtractions,
  resolveImportFund,
  resolutionsForConfirmItems,
  type ImportExtraction,
  type ImportItem,
} from "./scenario-import";
import { DEFAULT_SCENARIO, fundRate, type ScenarioInput } from "./projection";

function scenario(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    ...DEFAULT_SCENARIO,
    accounts: [
      {
        id: "roth-1",
        kind: "roth",
        label: "Roth IRA",
        balance: 100_000,
        fund: "sp500",
        customReturn: 0.1,
        linkedEventId: null,
        liquidFromYear: null,
      },
    ],
    incomes: [],
    events: [],
    personalMilestones: [],
    defaultFund: "conservative",
    ...overrides,
  };
}

function accountItem(
  partial: Partial<ImportItem> & { id: string },
  account: NonNullable<ImportItem["account"]>,
): ImportItem {
  return {
    id: partial.id,
    label: partial.label ?? account.label,
    valueLabel: partial.valueLabel ?? String(account.balance),
    explanation: partial.explanation ?? "from statement",
    kind: "account",
    scalar: null,
    account,
    income: null,
    event: null,
    college: null,
    milestone: null,
    matchExistingId: partial.matchExistingId ?? null,
    suggestedResolution: partial.suggestedResolution ?? "add",
    matchExplanation: partial.matchExplanation ?? null,
  };
}

describe("mapInvestmentHintToFund / resolveImportFund", () => {
  test("maps explicit allocations and tickers", () => {
    expect(mapInvestmentHintToFund("80/20")).toBe("moderate");
    expect(mapInvestmentHintToFund("60/40")).toBe("conservative");
    expect(mapInvestmentHintToFund("VOO")).toBe("sp500");
    expect(mapInvestmentHintToFund("money market")).toBe("cash");
    expect(mapInvestmentHintToFund("T-bills")).toBe("cash");
    expect(mapInvestmentHintToFund("heavy equity")).toBe("aggressive");
  });

  test("maps checking / cash-looking accounts to 0% checking fund", () => {
    expect(mapInvestmentHintToFund("Bank of America Checking")).toBe("checking");
    expect(mapInvestmentHintToFund("Cash Plus")).toBe("checking");
    expect(mapInvestmentHintToFund("PayPal balance")).toBe("checking");
    expect(mapInvestmentHintToFund("Settlement")).toBe("checking");
    expect(mapInvestmentHintToFund("Cash")).toBe("checking");
    expect(mapInvestmentHintToFund("brokerage cash")).toBe("checking");
    expect(fundRate("checking", 0.07)).toBe(0);
  });

  test("does not invent 80/20 when hint is missing or ambiguous", () => {
    expect(mapInvestmentHintToFund(null)).toBeNull();
    expect(mapInvestmentHintToFund("")).toBeNull();
    expect(mapInvestmentHintToFund("some random fund")).toBeNull();

    const unset = resolveImportFund({
      fund: null,
      customReturn: null,
      investmentHint: null,
    });
    expect(unset).toEqual({
      fund: null,
      customReturn: null,
      source: "unset",
      investmentHint: null,
    });
  });

  test("maps from account label when investmentHint is unset", () => {
    const resolved = resolveImportFund({
      fund: null,
      customReturn: null,
      investmentHint: null,
      label: "Bank of America Checking",
    });
    expect(resolved.fund).toBe("checking");
    expect(resolved.source).toBe("hint");
  });

  test("prefers model fund over hint", () => {
    const resolved = resolveImportFund({
      fund: "cash",
      customReturn: null,
      investmentHint: "VOO",
    });
    expect(resolved.fund).toBe("cash");
    expect(resolved.source).toBe("model");
  });
});

describe("applyImportItems", () => {
  test("honors skip / replace / add resolutions", () => {
    const base = scenario();
    const items: ImportItem[] = [
      {
        id: "age",
        label: "Age",
        valueLabel: "62",
        explanation: "stated age",
        kind: "scalar",
        scalar: { key: "age", value: 62 },
        account: null,
        income: null,
        event: null,
        college: null,
        milestone: null,
        matchExistingId: null,
        suggestedResolution: "import",
        matchExplanation: null,
      },
      accountItem(
        {
          id: "replace-roth",
          matchExistingId: "roth-1",
          suggestedResolution: "replace",
        },
        {
          accountKind: "roth",
          label: "Roth IRA",
          balance: 250_000,
          fund: "moderate",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
      accountItem(
        { id: "skip-trad", suggestedResolution: "skip" },
        {
          accountKind: "traditional",
          label: "Trad IRA",
          balance: 999_000,
          fund: "cash",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
      accountItem(
        { id: "add-taxable", suggestedResolution: "add" },
        {
          accountKind: "taxable",
          label: "Brokerage",
          balance: 50_000,
          fund: "cash",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
    ];

    const next = applyImportItems(base, items, {
      resolutions: {
        age: "import",
        "replace-roth": "replace",
        "skip-trad": "skip",
        "add-taxable": "add",
      },
    });

    expect(next.age).toBe(62);
    expect(next.accounts).toHaveLength(2);
    expect(next.accounts[0]).toMatchObject({
      id: "roth-1",
      balance: 250_000,
      fund: "moderate",
    });
    expect(next.accounts.some((a) => a.label === "Trad IRA")).toBe(false);
    expect(next.accounts.some((a) => a.label === "Brokerage")).toBe(true);
  });

  test("keeps existing fund on replace when extract leaves fund unset (no invent 80/20)", () => {
    const base = scenario();
    const next = applyImportItems(
      base,
      [
        accountItem(
          {
            id: "replace-roth",
            matchExistingId: "roth-1",
            suggestedResolution: "replace",
          },
          {
            accountKind: "roth",
            label: "Roth IRA",
            balance: 180_000,
            fund: null,
            investmentHint: null,
            customReturn: null,
            linkedCollegeLabel: null,
          },
        ),
      ],
      { resolutions: { "replace-roth": "replace" } },
    );

    expect(next.accounts[0]!.fund).toBe("sp500");
    expect(next.accounts[0]!.balance).toBe(180_000);
  });

  test("uses scenario defaultFund on add when fund is unset (not moderate invent)", () => {
    const base = scenario({ defaultFund: "aggressive" });
    const next = applyImportItems(
      base,
      [
        accountItem(
          { id: "add-roth", suggestedResolution: "add" },
          {
            accountKind: "roth",
            label: "Spouse Roth",
            balance: 40_000,
            fund: null,
            investmentHint: null,
            customReturn: null,
            linkedCollegeLabel: null,
          },
        ),
      ],
      { resolutions: { "add-roth": "add" } },
    );

    const added = next.accounts.find((a) => a.label === "Spouse Roth");
    expect(added?.fund).toBe("aggressive");
  });

  test("maps checking / cash labels to checking (0%) instead of defaultFund", () => {
    const base = scenario({ defaultFund: "moderate" });
    const next = applyImportItems(
      base,
      [
        accountItem(
          { id: "bofa-checking", suggestedResolution: "add" },
          {
            accountKind: "taxable",
            label: "Bank of America Checking",
            balance: 12_000,
            fund: null,
            investmentHint: null,
            customReturn: null,
            linkedCollegeLabel: null,
          },
        ),
        accountItem(
          { id: "paypal", suggestedResolution: "add" },
          {
            accountKind: "taxable",
            label: "PayPal balance",
            balance: 500,
            fund: null,
            investmentHint: "Cash",
            customReturn: null,
            linkedCollegeLabel: null,
          },
        ),
        accountItem(
          { id: "mmf", suggestedResolution: "add" },
          {
            accountKind: "taxable",
            label: "Brokerage MMF",
            balance: 8_000,
            fund: null,
            investmentHint: "money market",
            customReturn: null,
            linkedCollegeLabel: null,
          },
        ),
      ],
      {
        resolutions: {
          "bofa-checking": "add",
          paypal: "add",
          mmf: "add",
        },
      },
    );

    expect(
      next.accounts.find((a) => a.label === "Bank of America Checking")?.fund,
    ).toBe("checking");
    expect(next.accounts.find((a) => a.label === "PayPal balance")?.fund).toBe(
      "checking",
    );
    expect(next.accounts.find((a) => a.label === "Brokerage MMF")?.fund).toBe(
      "cash",
    );
  });

  test("migrates deprecated college items into college events", () => {
    const base = scenario();
    const items: ImportItem[] = [
      {
        id: "college-1",
        label: "Kid college",
        valueLabel: "$40k/yr",
        explanation: "tuition estimate",
        kind: "college",
        scalar: null,
        account: null,
        income: null,
        event: null,
        college: {
          label: "Kid college",
          startYear: 2,
          durationYears: 4,
          annualCost: 40_000,
        },
        milestone: null,
        matchExistingId: null,
        suggestedResolution: "add",
        matchExplanation: null,
      },
    ];

    const next = applyImportItems(base, items, {
      resolutions: { "college-1": "add" },
    });
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({
      kind: "college",
      label: "Kid college",
      startYear: 2,
      durationYears: 4,
      annualCost: 40_000,
    });
  });
});

describe("confirm modal apply helpers", () => {
  function scalarAge(id: string, age: number): ImportItem {
    return {
      id,
      label: "Age",
      valueLabel: String(age),
      explanation: "stated age",
      kind: "scalar",
      scalar: { key: "age", value: age },
      account: null,
      income: null,
      event: null,
      college: null,
      milestone: null,
      matchExistingId: null,
      suggestedResolution: "import",
      matchExplanation: null,
    };
  }

  test("×-removed items are omitted from apply (not in remaining list)", () => {
    const base = scenario({ age: 55 });
    const allItems: ImportItem[] = [
      scalarAge("age", 62),
      accountItem(
        { id: "add-trad", suggestedResolution: "add" },
        {
          accountKind: "traditional",
          label: "Trad IRA",
          balance: 80_000,
          fund: "cash",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
      accountItem(
        { id: "dismissed-brokerage", suggestedResolution: "add" },
        {
          accountKind: "taxable",
          label: "Brokerage",
          balance: 12_000,
          fund: "cash",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
    ];
    // Simulate × on Brokerage — only remaining items are passed to apply.
    const remaining = allItems.filter((i) => i.id !== "dismissed-brokerage");
    const analysis = analyzeImportItems(base, remaining);
    const resolutions = resolutionsForConfirmItems(remaining, analysis);

    const next = applyImportItems(base, remaining, { resolutions });

    expect(next.age).toBe(62);
    expect(next.accounts.some((a) => a.label === "Trad IRA")).toBe(true);
    expect(next.accounts.some((a) => a.label === "Brokerage")).toBe(false);
    expect(next.accounts).toHaveLength(2); // existing Roth + Trad
  });

  test("Import merges into current scenario (clearFirst false)", () => {
    const base = scenario({ age: 55 });
    const items: ImportItem[] = [
      scalarAge("age", 60),
      accountItem(
        {
          id: "replace-roth",
          matchExistingId: "roth-1",
          suggestedResolution: "replace",
        },
        {
          accountKind: "roth",
          label: "Roth IRA",
          balance: 300_000,
          fund: "moderate",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
      accountItem(
        { id: "add-trad", suggestedResolution: "add" },
        {
          accountKind: "traditional",
          label: "Trad IRA",
          balance: 90_000,
          fund: "cash",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
    ];
    const analysis = analyzeImportItems(base, items);
    const resolutions = resolutionsForConfirmItems(items, analysis, {
      "replace-roth": true,
    });

    const next = applyImportItems(base, items, {
      clearFirst: false,
      resolutions,
    });

    expect(next.age).toBe(60);
    expect(next.accounts).toHaveLength(2);
    expect(next.accounts[0]).toMatchObject({
      id: "roth-1",
      balance: 300_000,
      fund: "moderate",
    });
    expect(next.accounts.some((a) => a.label === "Trad IRA")).toBe(true);
  });

  test("Reset and Import clears scenario then applies remaining items", () => {
    const base = scenario({
      age: 55,
      annualSpend: 80_000,
      accounts: [
        {
          id: "roth-1",
          kind: "roth",
          label: "Roth IRA",
          balance: 100_000,
          fund: "sp500",
          customReturn: 0.1,
          linkedEventId: null,
          liquidFromYear: null,
        },
        {
          id: "old-trad",
          kind: "traditional",
          label: "Old Trad",
          balance: 50_000,
          fund: "cash",
          customReturn: 0.02,
          linkedEventId: null,
          liquidFromYear: null,
        },
      ],
    });
    const items: ImportItem[] = [
      scalarAge("age", 61),
      accountItem(
        { id: "new-roth", suggestedResolution: "add" },
        {
          accountKind: "roth",
          label: "New Roth",
          balance: 200_000,
          fund: "moderate",
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
    ];
    // After clear, nothing matches — resolutions are adds / import.
    const blankBase = {
      ...base,
      accounts: [],
      incomes: [],
      events: [],
      personalMilestones: [],
    };
    const analysis = analyzeImportItems(blankBase, items);
    const resolutions = resolutionsForConfirmItems(items, analysis);

    const next = applyImportItems(base, items, {
      clearFirst: true,
      resolutions,
    });

    expect(next.age).toBe(61);
    expect(next.accounts).toHaveLength(1);
    expect(next.accounts[0]).toMatchObject({
      label: "New Roth",
      balance: 200_000,
    });
    expect(next.accounts.some((a) => a.id === "roth-1")).toBe(false);
    expect(next.accounts.some((a) => a.label === "Old Trad")).toBe(false);
    // Planner defaults from blankScenario (not leftover annualSpend).
    expect(next.annualSpend).toBe(DEFAULT_SCENARIO.annualSpend);
  });

  test("resolutionsForConfirmItems defaults matched to replace; false adds", () => {
    const base = scenario();
    const items: ImportItem[] = [
      accountItem(
        {
          id: "matched",
          matchExistingId: "roth-1",
          suggestedResolution: "replace",
        },
        {
          accountKind: "roth",
          label: "Roth IRA",
          balance: 1,
          fund: null,
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
      accountItem(
        { id: "fresh", suggestedResolution: "add" },
        {
          accountKind: "taxable",
          label: "Brokerage",
          balance: 2,
          fund: null,
          investmentHint: null,
          customReturn: null,
          linkedCollegeLabel: null,
        },
      ),
      scalarAge("age", 70),
    ];
    const analysis = analyzeImportItems(base, items);

    expect(resolutionsForConfirmItems(items, analysis)).toEqual({
      matched: "replace",
      fresh: "add",
      age: "import",
    });
    expect(
      resolutionsForConfirmItems(items, analysis, { matched: false }),
    ).toEqual({
      matched: "add",
      fresh: "add",
      age: "import",
    });
  });
});

describe("import chunking and merge", () => {
  test("system prompt requires completeness rules", () => {
    expect(IMPORT_SYSTEM_PROMPT).toContain(IMPORT_COMPLETENESS_RULES);
    expect(IMPORT_COMPLETENESS_RULES).toMatch(/EVERY named account/i);
    expect(IMPORT_COMPLETENESS_RULES).toMatch(/never drop/i);
    expect(IMPORT_SYSTEM_PROMPT).not.toMatch(/PASS 2/i);
    expect(IMPORT_SYSTEM_PROMPT).not.toMatch(/second pass/i);
  });

  test("late-content fixture includes required tail labels", () => {
    for (const label of IMPORT_LATE_CONTENT_LABELS) {
      expect(IMPORT_LATE_CONTENT_FIXTURE).toContain(label);
    }
  });

  test("chunkImportSourceText covers full doc including late content", () => {
    const smallLimit = 800;
    const padding = "Vanguard Roth IRA line ".repeat(80);
    const huge = `${padding}\n\n${IMPORT_LATE_CONTENT_FIXTURE}`;
    expect(huge.length).toBeGreaterThan(smallLimit);

    // Historical bug: head-only slice drops trailing holdings.
    const naiveHead = huge.slice(0, smallLimit);
    expect(naiveHead.includes("Saronic via Capital Factory")).toBe(false);

    const { chunks } = chunkImportSourceText(huge, smallLimit);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(huge);
    for (const label of IMPORT_LATE_CONTENT_LABELS) {
      expect(chunks.join("")).toContain(label);
    }
    // Cover-to-cover: concat equals input; last slice still includes the document end.
    const last = chunks[chunks.length - 1]!;
    expect(last.length).toBeGreaterThan(0);
    expect(huge.endsWith(last)).toBe(true);
    expect(last).toContain("E2B aka FoundryLabs");
  });

  test("under limit stays a single full-text chunk", () => {
    const { chunks } = chunkImportSourceText(IMPORT_LATE_CONTENT_FIXTURE);
    expect(chunks).toEqual([IMPORT_LATE_CONTENT_FIXTURE]);
    expect(IMPORT_LATE_CONTENT_FIXTURE.length).toBeLessThan(
      IMPORT_TEXT_CHAR_LIMIT,
    );
  });

  test("isContextLengthError detects common gateway messages", () => {
    expect(isContextLengthError(new Error("context_length_exceeded"))).toBe(
      true,
    );
    expect(
      isContextLengthError(new Error("This model's maximum context length")),
    ).toBe(true);
    expect(isContextLengthError(new Error("prompt is too long"))).toBe(true);
    expect(isContextLengthError(new Error("Invalid JSON body"))).toBe(false);
  });

  test("mergeImportExtractions dedupes by kind+label+value and suffixes ids", () => {
    const primary: ImportExtraction = {
      summary: "Chunk 1",
      items: [
        accountItem(
          { id: "roth-vanguard", suggestedResolution: "add" },
          {
            accountKind: "roth",
            label: "Roth IRA",
            balance: 450_000,
            fund: "sp500",
            investmentHint: "VTSAX",
            customReturn: null,
            linkedCollegeLabel: null,
          },
        ),
      ],
    };

    const secondary: ImportExtraction = {
      summary: "Chunk 2",
      items: [
        // Same key as primary — dropped.
        accountItem(
          { id: "roth-dup", suggestedResolution: "add" },
          {
            accountKind: "roth",
            label: "Roth IRA",
            balance: 450_000,
            fund: "sp500",
            investmentHint: "VTSAX",
            customReturn: null,
            linkedCollegeLabel: null,
          },
        ),
        ...IMPORT_LATE_CONTENT_LABELS.map((label, i) =>
          accountItem(
            {
              id: i === 0 ? "roth-vanguard" : `tail-${i}`,
              suggestedResolution: "add",
            },
            {
              accountKind: "taxable",
              label,
              balance: 100_000 * (i + 1),
              fund: null,
              investmentHint: null,
              customReturn: null,
              linkedCollegeLabel: null,
            },
          ),
        ),
      ],
    };

    const merged = mergeImportExtractions(primary, secondary);
    const labels = merged.items
      .filter((item) => item.kind === "account" && item.account)
      .map((item) => item.account!.label);

    expect(labels.filter((l) => l === "Roth IRA")).toHaveLength(1);
    for (const label of IMPORT_LATE_CONTENT_LABELS) {
      expect(labels).toContain(label);
    }
    expect(merged.items.some((item) => item.id === "roth-vanguard-chunk")).toBe(
      true,
    );

    const listMerged = mergeImportExtractionList([primary, secondary]);
    expect(listMerged.items.length).toBe(merged.items.length);

    const applied = applyImportItems(scenario({ accounts: [] }), merged.items, {
      resolutions: Object.fromEntries(
        merged.items.map((item) => [item.id, "add" as const]),
      ),
    });
    for (const label of IMPORT_LATE_CONTENT_LABELS) {
      expect(applied.accounts.some((a) => a.label === label)).toBe(true);
    }
  });
});
