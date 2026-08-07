import { z } from "zod";
import {
  DEFAULT_SCENARIO,
  EVENT_KIND_LABEL,
  FUND_OPTIONS,
  FUND_PRESETS,
  KIND_LABEL,
  fmtMoney,
  fmtPct,
  fundRate,
  isCollegeEvent,
  uid,
  type Account,
  type AccountKind,
  type FundPreset,
  type IncomeStream,
  type LifeEvent,
  type LifeEventKind,
  type PersonalMilestone,
  type ScenarioInput,
  type SpendMode,
  type WithdrawOrder,
} from "@/lib/projection";
import { type UsStateCode, US_STATES } from "@/lib/us-taxes";

const accountKindSchema = z.enum([
  "taxable",
  "roth",
  "traditional",
  "401k",
  "529",
]);
const fundSchema = z.enum([
  "checking",
  "cash",
  "conservative",
  "moderate",
  "aggressive",
  "sp500",
  "custom",
]);
const scalarKeySchema = z.enum([
  "age",
  "endAge",
  "inflation",
  "spendMode",
  "annualSpend",
  "withdrawPct",
  "order",
  "modelTaxes",
  "stateCode",
  "taxableCostBasisPct",
  "defaultFund",
]);

/** Compact fund-option list for the import LLM prompt (stays in sync with FUND_OPTIONS). */
export function fundOptionsPromptBlock(): string {
  return FUND_OPTIONS.map((opt) => {
    if (opt.value === "custom") {
      return `- custom — ${opt.label}: only when a specific expected return % is stated; set customReturn as a decimal`;
    }
    const preset = FUND_PRESETS[opt.value];
    return `- ${opt.value} — ${opt.label} (${preset.label}, ${preset.blurb})`;
  }).join("\n");
}

/**
 * Map a stated ticker / fund name / allocation phrase to the closest FundPreset.
 * Returns null when the hint is missing or too ambiguous to choose confidently.
 */
export function mapInvestmentHintToFund(
  hint: string | null | undefined,
): FundPreset | null {
  const raw = hint?.trim();
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/[%$,]/g, " ");

  // Explicit allocation mixes
  if (/\b80\s*\/\s*20\b|\b80\s*-\s*20\b/.test(t)) return "moderate";
  if (/\b60\s*\/\s*40\b|\b60\s*-\s*40\b/.test(t)) return "conservative";
  if (/\b90\s*\/\s*10\b|\b100\s*\/\s*0\b|\b100%\s*equit/.test(t)) {
    return "aggressive";
  }

  // Money market / T-bills (~3.5%) — yield-bearing short-term cash
  if (
    /\b(money\s*market|mmf|t-?bills?|treasury\s*bills?|sweep|cma|fdic)\b/.test(
      t,
    )
  ) {
    return "cash";
  }

  // Cash / checking (0%) — bank checking, PayPal, settlement, bare cash balances
  if (
    /\b(checking|cash\s*plus|paypal|venmo|settlement|cash)\b/.test(t)
  ) {
    return "checking";
  }

  // S&P 500 / broad US equity index proxies
  if (
    /\b(s&p\s*500|sp500|s\s*&\s*p\s*500|spy|voo|vfiax|fxaix|swppx|ivv|splg|vfi|\bspx\b)\b/.test(
      t,
    ) ||
    /\btotal\s*(us\s*)?(stock|equity|market)\b/.test(t) ||
    /\b(vti|vtsax|fzrox|swtsx|itot)\b/.test(t)
  ) {
    return "sp500";
  }

  // Bond-heavy / conservative
  if (
    /\b(60\s*\/\s*40|conservative|balanced\s*fund|bond\s*heavy|bonds?\s*fund|agg\b|bnd\b|vbtlx|vbmfx)\b/.test(
      t,
    )
  ) {
    return "conservative";
  }

  // Moderate / target-date-ish balanced equity tilt
  if (
    /\b(80\s*\/\s*20|moderate|target[\s-]?date|lifecycle|balanced\s*allocation)\b/.test(
      t,
    )
  ) {
    return "moderate";
  }

  // Heavy equity (not a plain S&P/total-market ticker)
  if (
    /\b(heavy\s*equity|aggressive|growth\s*stock|all\s*stock|equity\s*heavy|qqq|vgt)\b/.test(
      t,
    )
  ) {
    return "aggressive";
  }

  // Stated expected return → custom (caller may set customReturn)
  if (/\b(expected|assumed|projected)\s+return\b/.test(t) || /\b\d+(\.\d+)?\s*%\s*(return|growth)\b/.test(t)) {
    return "custom";
  }

  return null;
}

export type ImportFundResolution = {
  fund: FundPreset | null;
  customReturn: number | null;
  source: "model" | "hint" | "unset";
  investmentHint: string | null;
};

type ImportAccountFundFields = {
  fund: FundPreset | null;
  customReturn: number | null;
  investmentHint: string | null;
  /** Account label — used as fallback hint (e.g. "BofA Checking"). */
  label?: string | null;
};

function asRate(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (value > 1) return value / 100;
  return value;
}

/** Prefer model fund id; else map investmentHint; else leave unset (no 80/20 invent). */
export function resolveImportFund(
  partial: ImportAccountFundFields,
): ImportFundResolution {
  const hint = partial.investmentHint?.trim() || null;
  const customReturn =
    partial.customReturn != null && Number.isFinite(partial.customReturn)
      ? asRate(partial.customReturn)
      : null;

  if (partial.fund != null) {
    return {
      fund: partial.fund,
      customReturn:
        partial.fund === "custom"
          ? (customReturn ?? FUND_PRESETS.moderate.rate)
          : customReturn,
      source: "model",
      investmentHint: hint,
    };
  }

  const fromHint = mapInvestmentHintToFund(hint);
  if (fromHint) {
    return {
      fund: fromHint,
      customReturn:
        fromHint === "custom"
          ? (customReturn ?? FUND_PRESETS.moderate.rate)
          : customReturn,
      source: "hint",
      investmentHint: hint,
    };
  }

  const fromLabel = mapInvestmentHintToFund(partial.label);
  if (fromLabel) {
    return {
      fund: fromLabel,
      customReturn:
        fromLabel === "custom"
          ? (customReturn ?? FUND_PRESETS.moderate.rate)
          : customReturn,
      source: "hint",
      investmentHint: hint ?? (partial.label?.trim() || null),
    };
  }

  return {
    fund: null,
    customReturn,
    source: "unset",
    investmentHint: hint,
  };
}

export const importItemSchema = z.object({
  id: z
    .string()
    .describe("Stable id for this patch, e.g. age or account-roth-ira"),
  label: z.string().describe("Short field name shown in the confirmation list"),
  valueLabel: z
    .string()
    .describe("Human-readable value, e.g. $650,000 or 58 or FL"),
  explanation: z
    .string()
    .describe(
      "One short clause: where this number came from (source text/figure). No essays.",
    ),
  kind: z.enum(["scalar", "account", "income", "event", "college", "milestone"]),
  scalar: z
    .object({
      key: scalarKeySchema,
      value: z.union([z.number(), z.string(), z.boolean()]),
    })
    .nullable(),
  account: z
    .object({
      accountKind: accountKindSchema,
      label: z.string(),
      balance: z.number().nonnegative(),
      fund: fundSchema
        .nullable()
        .describe(
          "Closest fund preset id when allocation/ticker/fund is clear. Null when investment style is absent or ambiguous — never invent moderate/80/20.",
        ),
      investmentHint: z
        .string()
        .nullable()
        .describe(
          "Raw stated investment when present (fund name, ticker, allocation like VTSAX or 60/40). Null if not mentioned.",
        ),
      customReturn: z
        .number()
        .nullable()
        .describe(
          "Decimal expected return only when a specific % is stated (usually with fund=custom). Otherwise null.",
        ),
      linkedCollegeLabel: z.string().nullable(),
      liquidFromYear: z
        .number()
        .int()
        .nullable()
        .describe(
          "Calendar year the account becomes drawable only when the source clearly locks liquidity until a year. Otherwise null — never invent locks.",
        ),
    })
    .nullable(),
  income: z
    .object({
      label: z.string(),
      annualAmount: z.number().nonnegative(),
      startAge: z.number(),
      endAge: z.number().nullable(),
      inflates: z.boolean().nullable(),
    })
    .nullable(),
  event: z
    .object({
      label: z.string(),
      eventKind: z
        .enum(["college", "wedding", "home", "other"])
        .nullable()
        .describe("Defaults to college when omitted"),
      startYear: z
        .number()
        .int()
        .nonnegative()
        .describe("Years from now until the event starts (0 = this calendar year)"),
      durationYears: z
        .number()
        .int()
        .positive()
        .describe("1 for one-shot costs; multi-year for college-style spreads"),
      annualCost: z
        .number()
        .nonnegative()
        .describe("Cost per year; for durationYears=1 this is the total cost"),
    })
    .nullable(),
  college: z
    .object({
      label: z.string(),
      startYear: z
        .number()
        .int()
        .nonnegative()
        .describe("Years from now until college starts (0 = this calendar year)"),
      durationYears: z.number().int().positive(),
      annualCost: z.number().nonnegative(),
    })
    .nullable()
    .describe("Deprecated alias for event with eventKind=college"),
  milestone: z
    .object({
      label: z.string().describe("Personal milestone label, e.g. Move to FL"),
      yearOffset: z
        .number()
        .int()
        .nonnegative()
        .nullable()
        .describe("Years from now (0 = this calendar year)"),
      age: z
        .number()
        .nullable()
        .describe("Age at the milestone when yearOffset is not given"),
    })
    .nullable()
    .describe("Personal timeline marker (not a cost event)"),
  matchExistingId: z
    .string()
    .nullable()
    .describe(
      "Id of the existing scenario entity this item updates (from the scenario summary). Null when adding new or for scalars that only compare values. Never match solely on account kind (Roth/Trad/etc.) or balance — different people/accounts must stay separate.",
    ),
  suggestedResolution: z
    .enum(["skip", "replace", "add", "keep", "import"])
    .describe(
      "List entities: replace when matchExistingId is set, add when new. Scalars: import to apply, keep when same as current, skip to omit.",
    ),
  matchExplanation: z
    .string()
    .nullable()
    .describe(
      "Optional. ≤1 short clause only when matching an existing item (e.g. same owner + account). Empty/null for new items — never explain non-matches.",
    ),
});

export const importExtractionSchema = z.object({
  summary: z
    .string()
    .describe("One-line summary of what was confidently extracted"),
  items: z.array(importItemSchema),
});

export type ImportItem = z.infer<typeof importItemSchema>;
export type ImportExtraction = z.infer<typeof importExtractionSchema>;
export type ScalarKey = z.infer<typeof scalarKeySchema>;

/** Per-item resolution chosen in the confirm modal. */
export type ImportResolution = "skip" | "replace" | "add" | "keep" | "import";

export type ImportItemAnalysis = {
  itemId: string;
  /** True when a list entity matches an existing row, or a scalar differs from current. */
  conflict: boolean;
  matchIndex: number;
  matchExistingId: string | null;
  existingLabel: string | null;
  existingValueLabel: string | null;
  currentValueLabel: string | null;
  matchExplanation: string | null;
  defaultResolution: ImportResolution;
};

export type ApplyImportOptions = {
  clearFirst?: boolean;
  /** Map of import item id → resolution. Missing keys use analysis defaults. */
  resolutions?: Record<string, ImportResolution>;
};

const STATE_CODES = new Set(US_STATES.map((s) => s.code));

/** Empty lists + planner defaults — used for “clear first, then apply”. */
export function blankScenario(): ScenarioInput {
  return {
    ...DEFAULT_SCENARIO,
    accounts: [],
    incomes: [],
    events: [],
    personalMilestones: [],
  };
}

function normLabel(label: string): string {
  return label.trim().toLowerCase();
}

function indexById<T extends { id: string }>(
  list: T[],
  id: string | null | undefined,
): number {
  if (!id) return -1;
  return list.findIndex((x) => x.id === id);
}

/** Compact scenario snapshot for the import LLM (ids + labels + key values). */
export function summarizeScenarioForImport(scenario: ScenarioInput) {
  return {
    age: scenario.age,
    endAge: scenario.endAge,
    inflation: scenario.inflation,
    spendMode: scenario.spendMode,
    annualSpend: scenario.annualSpend,
    withdrawPct: scenario.withdrawPct,
    order: scenario.order,
    modelTaxes: scenario.modelTaxes,
    stateCode: scenario.stateCode,
    defaultFund: scenario.defaultFund,
    accounts: scenario.accounts.map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      balance: a.balance,
      fund: a.fund,
    })),
    incomes: scenario.incomes.map((inc) => ({
      id: inc.id,
      label: inc.label,
      annualAmount: inc.annualAmount,
      startAge: inc.startAge,
      endAge: inc.endAge,
    })),
    events: scenario.events.map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      label: ev.label,
      startYear: ev.startYear,
      durationYears: ev.durationYears,
      annualCost: ev.annualCost,
    })),
    personalMilestones: scenario.personalMilestones.map((m) => ({
      id: m.id,
      label: m.label,
      yearOffset: m.yearOffset,
    })),
  };
}

export type ScenarioImportSummary = ReturnType<typeof summarizeScenarioForImport>;

function fallbackResolution(item: ImportItem): ImportResolution {
  if (item.kind === "scalar") return "import";
  return item.matchExistingId ? "replace" : "add";
}

function llmResolution(item: ImportItem): ImportResolution {
  const suggested = item.suggestedResolution;
  if (
    suggested === "skip" ||
    suggested === "replace" ||
    suggested === "add" ||
    suggested === "keep" ||
    suggested === "import"
  ) {
    return suggested;
  }
  return fallbackResolution(item);
}

function formatScalarValue(
  key: ScalarKey,
  value: number | string | boolean,
): string {
  switch (key) {
    case "inflation":
    case "withdrawPct":
    case "taxableCostBasisPct":
      return fmtPct(asRate(Number(value)));
    case "annualSpend":
      return fmtMoney(Number(value));
    case "modelTaxes":
      return value ? "On" : "Off";
    case "age":
    case "endAge":
      return String(Math.round(Number(value)));
    default:
      return String(value);
  }
}

export function currentScalarLabel(
  scenario: ScenarioInput,
  key: ScalarKey,
): string {
  const raw = scenario[key];
  return formatScalarValue(key, raw as number | string | boolean);
}

function scalarsEqual(
  key: ScalarKey,
  current: number | string | boolean,
  proposed: number | string | boolean,
): boolean {
  if (key === "inflation" || key === "withdrawPct" || key === "taxableCostBasisPct") {
    const a = asRate(Number(current));
    const b = asRate(Number(proposed));
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  }
  if (key === "age" || key === "endAge" || key === "annualSpend") {
    return Math.round(Number(current)) === Math.round(Number(proposed));
  }
  if (key === "modelTaxes") return Boolean(current) === Boolean(proposed);
  if (key === "stateCode") {
    return String(current).toUpperCase() === String(proposed).toUpperCase();
  }
  return current === proposed;
}

function normalizeScalar(
  key: ScalarKey,
  value: number | string | boolean,
): Partial<ScenarioInput> | null {
  switch (key) {
    case "age": {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 18 || n > 100) return null;
      return { age: Math.round(n) };
    }
    case "endAge": {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 40 || n > 120) return null;
      return { endAge: Math.round(n) };
    }
    case "inflation": {
      const n = asRate(Number(value));
      if (!Number.isFinite(n) || n < 0 || n > 0.2) return null;
      return { inflation: n };
    }
    case "spendMode": {
      if (value !== "fixed" && value !== "percent") return null;
      return { spendMode: value as SpendMode };
    }
    case "annualSpend": {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return null;
      return { annualSpend: Math.round(n), spendMode: "fixed" };
    }
    case "withdrawPct": {
      const n = asRate(Number(value));
      if (!Number.isFinite(n) || n < 0 || n > 0.2) return null;
      return { withdrawPct: n, spendMode: "percent" };
    }
    case "order": {
      if (
        value !== "taxable-trad-roth" &&
        value !== "taxable-roth-trad" &&
        value !== "pro-rata"
      ) {
        return null;
      }
      return { order: value as WithdrawOrder };
    }
    case "modelTaxes": {
      if (typeof value !== "boolean") return null;
      return { modelTaxes: value };
    }
    case "taxableCostBasisPct": {
      const n = asRate(Number(value));
      if (!Number.isFinite(n)) return null;
      return { taxableCostBasisPct: Math.max(0, Math.min(1, n)) };
    }
    case "stateCode": {
      const code = String(value).toUpperCase() as UsStateCode;
      if (!STATE_CODES.has(code)) return null;
      return { stateCode: code };
    }
    case "defaultFund": {
      if (
        value !== "checking" &&
        value !== "cash" &&
        value !== "conservative" &&
        value !== "moderate" &&
        value !== "aggressive" &&
        value !== "sp500" &&
        value !== "custom"
      ) {
        return null;
      }
      return { defaultFund: value as FundPreset };
    }
    default:
      return null;
  }
}

function milestoneValueLabel(m: PersonalMilestone): string {
  return `${m.label} · yr+${m.yearOffset}`;
}

function accountValueLabel(a: Account): string {
  return `${KIND_LABEL[a.kind]} · ${fmtMoney(a.balance)}`;
}

function incomeValueLabel(inc: IncomeStream): string {
  const end = inc.endAge == null ? "ongoing" : `→${inc.endAge}`;
  return `${fmtMoney(inc.annualAmount)}/yr · ${inc.startAge}${end}`;
}

function eventValueLabel(ev: LifeEvent): string {
  const cost =
    ev.durationYears === 1
      ? fmtMoney(ev.annualCost)
      : `${fmtMoney(ev.annualCost)}/yr · ${ev.durationYears}y`;
  return `${EVENT_KIND_LABEL[ev.kind]} · ${cost} · yr+${ev.startYear}`;
}

/** One short line for UI; drop empty. */
export function shortImportClause(
  raw: string | null | undefined,
  maxLen = 120,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const oneLine = trimmed.split(/\r?\n/)[0]!.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
}

/**
 * Keep match blurbs only when matching an existing entity; clamp to one short clause.
 * Never surface "why this is new" essays.
 */
function normalizeMatchExplanation(
  raw: string | null | undefined,
  matched: boolean,
): string | null {
  if (!matched) return null;
  return shortImportClause(raw);
}

/** Resolve LLM match proposals against a base scenario for the confirm-modal UI. */
export function analyzeImportItems(
  scenario: ScenarioInput,
  items: ImportItem[],
): ImportItemAnalysis[] {
  return items.map((item) => {
    const suggested = llmResolution(item);

    if (item.kind === "scalar" && item.scalar) {
      const key = item.scalar.key;
      const current = scenario[key] as number | string | boolean;
      const currentLabel = formatScalarValue(key, current);
      const same = scalarsEqual(key, current, item.scalar.value);
      let defaultResolution: ImportResolution = suggested;
      if (
        defaultResolution !== "skip" &&
        defaultResolution !== "keep" &&
        defaultResolution !== "import"
      ) {
        defaultResolution = same ? "keep" : "import";
      }
      return {
        itemId: item.id,
        conflict: !same,
        matchIndex: -1,
        matchExistingId: null,
        existingLabel: null,
        existingValueLabel: null,
        currentValueLabel: currentLabel,
        // Scalars compare values in the UI; no match-explanation essay.
        matchExplanation: null,
        defaultResolution,
      };
    }

    if (item.kind === "account" && item.account) {
      const matchIndex = indexById(scenario.accounts, item.matchExistingId);
      const existing = matchIndex >= 0 ? scenario.accounts[matchIndex] : null;
      const matched = existing != null;
      return {
        itemId: item.id,
        conflict: matched,
        matchIndex,
        matchExistingId: matched ? existing.id : null,
        existingLabel: existing?.label ?? null,
        existingValueLabel: existing ? accountValueLabel(existing) : null,
        currentValueLabel: null,
        matchExplanation: normalizeMatchExplanation(
          item.matchExplanation,
          matched,
        ),
        defaultResolution: matched
          ? suggested === "skip" || suggested === "add" || suggested === "replace"
            ? suggested
            : "replace"
          : suggested === "skip"
            ? "skip"
            : "add",
      };
    }

    if (item.kind === "income" && item.income) {
      const matchIndex = indexById(scenario.incomes, item.matchExistingId);
      const existing = matchIndex >= 0 ? scenario.incomes[matchIndex] : null;
      const matched = existing != null;
      return {
        itemId: item.id,
        conflict: matched,
        matchIndex,
        matchExistingId: matched ? existing.id : null,
        existingLabel: existing?.label ?? null,
        existingValueLabel: existing ? incomeValueLabel(existing) : null,
        currentValueLabel: null,
        matchExplanation: normalizeMatchExplanation(
          item.matchExplanation,
          matched,
        ),
        defaultResolution: matched
          ? suggested === "skip" || suggested === "add" || suggested === "replace"
            ? suggested
            : "replace"
          : suggested === "skip"
            ? "skip"
            : "add",
      };
    }

    if (
      (item.kind === "event" && item.event) ||
      (item.kind === "college" && item.college)
    ) {
      const matchIndex = indexById(scenario.events, item.matchExistingId);
      const existing = matchIndex >= 0 ? scenario.events[matchIndex] : null;
      const matched = existing != null;
      return {
        itemId: item.id,
        conflict: matched,
        matchIndex,
        matchExistingId: matched ? existing.id : null,
        existingLabel: existing?.label ?? null,
        existingValueLabel: existing ? eventValueLabel(existing) : null,
        currentValueLabel: null,
        matchExplanation: normalizeMatchExplanation(
          item.matchExplanation,
          matched,
        ),
        defaultResolution: matched
          ? suggested === "skip" || suggested === "add" || suggested === "replace"
            ? suggested
            : "replace"
          : suggested === "skip"
            ? "skip"
            : "add",
      };
    }

    if (item.kind === "milestone" && item.milestone) {
      const matchIndex = indexById(
        scenario.personalMilestones,
        item.matchExistingId,
      );
      const existing =
        matchIndex >= 0 ? scenario.personalMilestones[matchIndex] : null;
      const matched = existing != null;
      return {
        itemId: item.id,
        conflict: matched,
        matchIndex,
        matchExistingId: matched ? existing.id : null,
        existingLabel: existing?.label ?? null,
        existingValueLabel: existing ? milestoneValueLabel(existing) : null,
        currentValueLabel: null,
        matchExplanation: normalizeMatchExplanation(
          item.matchExplanation,
          matched,
        ),
        defaultResolution: matched
          ? suggested === "skip" || suggested === "add" || suggested === "replace"
            ? suggested
            : "replace"
          : suggested === "skip"
            ? "skip"
            : "add",
      };
    }

    return {
      itemId: item.id,
      conflict: false,
      matchIndex: -1,
      matchExistingId: null,
      existingLabel: null,
      existingValueLabel: null,
      currentValueLabel: null,
      matchExplanation: null,
      defaultResolution: "add",
    };
  });
}

export function defaultResolutions(
  analysis: ImportItemAnalysis[],
): Record<string, ImportResolution> {
  const out: Record<string, ImportResolution> = {};
  for (const row of analysis) out[row.itemId] = row.defaultResolution;
  return out;
}

/**
 * Resolutions for the confirm modal after ×-dismiss: remaining items are applied.
 * Matched list entities default to replace; pass replaceExisting[id]=false to add instead.
 * Scalars always import (× is how the user omits them).
 */
export function resolutionsForConfirmItems(
  items: ImportItem[],
  analysis: ImportItemAnalysis[],
  replaceExisting: Record<string, boolean> = {},
): Record<string, ImportResolution> {
  const analysisById = new Map(analysis.map((row) => [row.itemId, row]));
  const out: Record<string, ImportResolution> = {};
  for (const item of items) {
    if (item.kind === "scalar") {
      out[item.id] = "import";
      continue;
    }
    const row = analysisById.get(item.id);
    const matched =
      row != null &&
      (row.matchIndex >= 0 || row.matchExistingId != null);
    if (matched) {
      out[item.id] = replaceExisting[item.id] === false ? "add" : "replace";
    } else {
      out[item.id] = "add";
    }
  }
  return out;
}

function buildAccount(
  partial: NonNullable<ImportItem["account"]>,
  scenario: ScenarioInput,
  events: LifeEvent[],
  existing: Account | null,
  logContext?: { itemId: string; resolution: ImportResolution },
): Account {
  const resolved = resolveImportFund({
    fund: partial.fund,
    customReturn: partial.customReturn,
    investmentHint: partial.investmentHint ?? null,
    label: partial.label,
  });

  // Only apply a mapped fund when the model/hint provided one. On replace, keep
  // the existing fund; on add, fall back to the scenario's defaultFund (planner
  // default for new rows — not an invented moderate from the extract).
  let fund: FundPreset;
  let fundDecision: string;
  if (resolved.fund != null) {
    fund = resolved.fund;
    fundDecision = `set from ${resolved.source}`;
  } else if (existing) {
    fund = existing.fund;
    fundDecision = "unset — kept existing";
  } else {
    fund = scenario.defaultFund;
    fundDecision = "unset — scenario defaultFund";
  }

  let customReturn: number;
  if (resolved.fund != null) {
    customReturn =
      resolved.fund === "custom"
        ? (resolved.customReturn ?? existing?.customReturn ?? 0.07)
        : fundRate(resolved.fund, 0.07);
  } else if (existing) {
    customReturn = existing.customReturn;
  } else {
    customReturn = fundRate(fund, 0.07);
  }

  console.info("[import] fund mapping", {
    itemId: logContext?.itemId ?? null,
    resolution: logContext?.resolution ?? null,
    label: partial.label,
    accountKind: partial.accountKind,
    modelFund: partial.fund,
    investmentHint: resolved.investmentHint,
    mappedSource: resolved.source,
    appliedFund: fund,
    decision: fundDecision,
    keptExisting: existing != null && resolved.fund == null,
  });

  let linkedEventId: string | null = null;
  if (partial.accountKind === "529") {
    const linkLabel = partial.linkedCollegeLabel?.trim();
    if (linkLabel) {
      linkedEventId =
        events.find((e) => normLabel(e.label) === normLabel(linkLabel))?.id ??
        null;
    }
    if (!linkedEventId) {
      linkedEventId =
        events.find((e) => isCollegeEvent(e))?.id ?? events[0]?.id ?? null;
    }
  }

  return {
    id: uid(partial.accountKind),
    kind: partial.accountKind as AccountKind,
    label: partial.label.trim() || KIND_LABEL[partial.accountKind],
    balance: Math.round(partial.balance),
    fund,
    customReturn,
    linkedEventId,
    liquidFromYear:
      typeof partial.liquidFromYear === "number" &&
      Number.isFinite(partial.liquidFromYear) &&
      partial.liquidFromYear > 0
        ? Math.round(partial.liquidFromYear)
        : null,
  };
}

function resolveForItem(
  item: ImportItem,
  analysis: ImportItemAnalysis | undefined,
  resolutions: Record<string, ImportResolution> | undefined,
): ImportResolution {
  const chosen = resolutions?.[item.id];
  if (chosen) return chosen;
  return analysis?.defaultResolution ?? (item.kind === "scalar" ? "import" : "add");
}

/** Apply selected import items onto the scenario, honoring clear-first + resolutions. */
export function applyImportItems(
  scenario: ScenarioInput,
  items: ImportItem[],
  options: ApplyImportOptions = {},
): ScenarioInput {
  const base = options.clearFirst ? blankScenario() : scenario;
  const analysis = analyzeImportItems(base, items);
  const analysisById = new Map(analysis.map((a) => [a.itemId, a]));

  let next: ScenarioInput = { ...base };
  let accounts = [...base.accounts];
  const incomes = [...base.incomes];
  const events = [...base.events];
  const personalMilestones = [...base.personalMilestones];

  for (const item of items) {
    const row = analysisById.get(item.id);
    const resolution = resolveForItem(item, row, options.resolutions);

    if (item.kind === "scalar" && item.scalar) {
      if (resolution === "skip" || resolution === "keep") continue;
      const patch = normalizeScalar(item.scalar.key, item.scalar.value);
      if (patch) next = { ...next, ...patch };
      continue;
    }

    if (resolution === "skip" || resolution === "keep") continue;

    if (item.kind === "milestone" && item.milestone) {
      const raw = item.milestone;
      const label = raw.label.trim() || "Milestone";
      let yearOffset =
        raw.yearOffset != null && Number.isFinite(raw.yearOffset)
          ? Math.max(0, Math.round(raw.yearOffset))
          : raw.age != null && Number.isFinite(raw.age)
            ? Math.max(0, Math.round(raw.age) - next.age)
            : Math.round((next.endAge - next.age) / 3);
      yearOffset = Math.max(
        0,
        Math.min(Math.max(0, next.endAge - next.age), yearOffset),
      );
      const patch: PersonalMilestone = {
        id: uid("milestone"),
        label,
        yearOffset,
      };
      const matchIndex =
        row && row.matchIndex >= 0
          ? row.matchIndex
          : indexById(personalMilestones, item.matchExistingId);
      if (resolution === "replace" && matchIndex >= 0) {
        personalMilestones[matchIndex] = {
          ...personalMilestones[matchIndex],
          ...patch,
          id: personalMilestones[matchIndex].id,
        };
      } else {
        personalMilestones.push(patch);
      }
      continue;
    }

    if (
      (item.kind === "event" && item.event) ||
      (item.kind === "college" && item.college)
    ) {
      const raw = item.event ?? item.college!;
      const eventKind: LifeEventKind =
        item.event?.eventKind === "wedding" ||
        item.event?.eventKind === "home" ||
        item.event?.eventKind === "other" ||
        item.event?.eventKind === "college"
          ? item.event.eventKind
          : "college";
      const label =
        raw.label.trim() ||
        (eventKind === "college"
          ? "College"
          : eventKind === "wedding"
            ? "Wedding"
            : eventKind === "home"
              ? "Second home"
              : "Major expense");
      const maxYears = eventKind === "college" ? 8 : 30;
      const patch: LifeEvent = {
        id: uid("event"),
        kind: eventKind,
        label,
        startYear: Math.max(0, Math.round(raw.startYear)),
        durationYears: Math.max(
          1,
          Math.min(maxYears, Math.round(raw.durationYears)),
        ),
        annualCost: Math.round(raw.annualCost),
      };
      const matchIndex =
        row && row.matchIndex >= 0
          ? row.matchIndex
          : indexById(events, item.matchExistingId);
      if (resolution === "replace" && matchIndex >= 0) {
        events[matchIndex] = {
          ...events[matchIndex],
          ...patch,
          id: events[matchIndex].id,
        };
      } else {
        events.push(patch);
      }
      continue;
    }

    if (item.kind === "income" && item.income) {
      const inc = item.income;
      const label = inc.label.trim() || "Retirement income";
      const patch: IncomeStream = {
        id: uid("income"),
        label,
        annualAmount: Math.round(inc.annualAmount),
        startAge: Math.round(inc.startAge),
        endAge:
          inc.endAge == null || Number.isNaN(Number(inc.endAge))
            ? null
            : Math.round(Number(inc.endAge)),
        inflates: inc.inflates ?? true,
      };
      const matchIndex =
        row && row.matchIndex >= 0
          ? row.matchIndex
          : indexById(incomes, item.matchExistingId);
      if (resolution === "replace" && matchIndex >= 0) {
        incomes[matchIndex] = {
          ...incomes[matchIndex],
          ...patch,
          id: incomes[matchIndex].id,
        };
      } else {
        incomes.push(patch);
      }
      continue;
    }

    if (item.kind === "account" && item.account) {
      const matchIndex =
        row && row.matchIndex >= 0
          ? row.matchIndex
          : indexById(accounts, item.matchExistingId);
      const existing = matchIndex >= 0 ? accounts[matchIndex] : null;
      const built = buildAccount(item.account, next, events, existing, {
        itemId: item.id,
        resolution,
      });
      if (resolution === "replace" && matchIndex >= 0) {
        accounts[matchIndex] = {
          ...accounts[matchIndex],
          kind: built.kind,
          label: built.label,
          balance: built.balance,
          fund: built.fund,
          customReturn: built.customReturn,
          linkedEventId: built.kind === "529" ? built.linkedEventId : null,
        };
      } else {
        accounts.push(built);
      }
    }
  }

  accounts = accounts.map((a) => {
    if (a.kind !== "529") return a;
    const item = items.find(
      (i) =>
        i.kind === "account" &&
        i.account &&
        normLabel(i.account.label) === normLabel(a.label),
    );
    const linkLabel = item?.account?.linkedCollegeLabel?.trim();
    if (!linkLabel) return a;
    const ev = events.find((e) => normLabel(e.label) === normLabel(linkLabel));
    return ev ? { ...a, linkedEventId: ev.id } : a;
  });

  if (next.endAge <= next.age) {
    next = { ...next, endAge: next.age + 1 };
  }

  return {
    ...next,
    accounts,
    incomes,
    events,
    personalMilestones,
  };
}

/**
 * Soft per-request char budget for one generateObject call. Pastes within this
 * limit are sent in full. Larger pastes are split into sequential chunks that
 * together cover the entire document start→end (never head-truncate away the end).
 *
 * Also used as the starting size when retrying after a context-length API error
 * (halved on each retry).
 */
export const IMPORT_TEXT_CHAR_LIMIT = 400_000;

/** Floor when re-chunking after context-length errors. */
export const IMPORT_TEXT_MIN_CHUNK = 20_000;

export type ChunkedImportText = {
  /** Sequential slices covering the full paste; length 1 when under the limit. */
  chunks: string[];
};

/**
 * Split paste into sequential chunks that cover the entire document.
 * Never drops the middle or end — historical bug was slice(0, 60_000).
 */
export function chunkImportSourceText(
  text: string,
  limit = IMPORT_TEXT_CHAR_LIMIT,
): ChunkedImportText {
  if (!text) return { chunks: [] };
  if (text.length <= limit) return { chunks: [text] };

  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += limit) {
    chunks.push(text.slice(offset, offset + limit));
  }
  return { chunks };
}

/** True when an API/gateway error looks like a context-window / token-limit failure. */
export function isContextLengthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /context[\s_-]?length|too many tokens|maximum context|prompt is too long|token[\s_-]?limit|context window|max_tokens|input.?too.?long/i.test(
    message,
  );
}

function importItemDedupeKey(item: ImportItem): string {
  if (item.kind === "account" && item.account) {
    return `account:${normLabel(item.account.label)}:${item.account.accountKind}:${Math.round(item.account.balance)}`;
  }
  if (item.kind === "scalar" && item.scalar) {
    return `scalar:${item.scalar.key}`;
  }
  if (item.kind === "income" && item.income) {
    return `income:${normLabel(item.income.label)}:${Math.round(item.income.annualAmount)}`;
  }
  if (item.kind === "event" && item.event) {
    return `event:${normLabel(item.event.label)}:${item.event.startYear}:${Math.round(item.event.annualCost)}`;
  }
  if (item.kind === "college" && item.college) {
    return `college:${normLabel(item.college.label)}:${item.college.startYear}:${Math.round(item.college.annualCost)}`;
  }
  if (item.kind === "milestone" && item.milestone) {
    return `milestone:${normLabel(item.milestone.label)}`;
  }
  return `id:${item.id}`;
}

/**
 * Merge chunk extractions into one list. Prefers earlier items on duplicate keys
 * (kind + label + value); suffixes colliding ids from later chunks.
 */
export function mergeImportExtractions(
  primary: ImportExtraction,
  secondary: ImportExtraction,
): ImportExtraction {
  const seen = new Set<string>();
  const usedIds = new Set<string>();
  const items: ImportItem[] = [];

  for (const item of primary.items) {
    seen.add(importItemDedupeKey(item));
    usedIds.add(item.id);
    items.push(item);
  }

  for (const item of secondary.items) {
    const key = importItemDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    let id = item.id;
    if (usedIds.has(id)) {
      id = `${id}-chunk`;
      let n = 2;
      while (usedIds.has(id)) {
        id = `${item.id}-chunk-${n}`;
        n += 1;
      }
    }
    usedIds.add(id);
    items.push(id === item.id ? item : { ...item, id });
  }

  const summary = [primary.summary, secondary.summary]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" · ");

  return {
    summary: summary || primary.summary || secondary.summary,
    items,
  };
}

/** Fold many chunk extractions left-to-right via {@link mergeImportExtractions}. */
export function mergeImportExtractionList(
  extractions: ImportExtraction[],
): ImportExtraction {
  if (extractions.length === 0) {
    return { summary: "", items: [] };
  }
  let merged = extractions[0]!;
  for (let i = 1; i < extractions.length; i++) {
    merged = mergeImportExtractions(merged, extractions[i]!);
  }
  return merged;
}

/** Completeness rules for every extraction pass (full doc or one chunk). */
export const IMPORT_COMPLETENESS_RULES = `COMPLETENESS:
- Extract EVERY named account / balance found in the text you are given.
- Never drop, skip, or merge distinct line items into one bucket (e.g. do not collapse many holdings into "private equity" / "alternatives").
- Keep distinct labels. Cash / brokerage cash lines with stated balances are accounts.
- Process all of the provided text, including content near the end of this chunk or document.`;

export const IMPORT_SYSTEM_PROMPT = `You extract retirement-planning fields from user-provided text and/or screenshots/PDF page images, then decide how each extracted item relates to the CURRENT SCENARIO summary provided in the request.

Return ONLY fields you are confident about. Do not invent balances, ages, or rates that are not clearly present. Prefer omitting a field over guessing. Do not invent fake precision (e.g. don't turn "~$400k" into 400123).

Map into this planner's shape:
- age / endAge (integers)
- inflation as a decimal rate (0.03 for 3%)
- spendMode "fixed" with annualSpend, OR "percent" with withdrawPct as decimal (0.04 for 4%)
- stateCode: 2-letter US state
- order: taxable-trad-roth | taxable-roth-trad | pro-rata
- modelTaxes: boolean when gross-up / tax modeling is mentioned
- taxableCostBasisPct: decimal fraction of taxable brokerage that is cost basis (0.5 = 50%); optional
- defaultFund: ONLY when the source clearly states a default portfolio style for the whole plan. Use one of the fund ids below. If unclear, omit — never invent moderate/80/20.
- accounts: taxable | roth | traditional | 401k | 529 with label + balance
  - When the source states how the account is invested (fund name, ticker, allocation mix like 60/40 or 80/20, "S&P 500", cash, etc.):
    - Set investmentHint to the raw phrase/ticker
    - Set fund to the closest matching id from AVAILABLE FUND OPTIONS below when you are confident
    - If the investment style is missing or ambiguous, set fund=null and omit inventing a default (do NOT default to moderate/80/20)
  - customReturn: decimal only when a specific expected return % is stated (typically with fund=custom); otherwise null
  - Each named brokerage / taxable / private / fund line with a balance is its own account
- incomes: retirement-phase streams only (Social Security, pension, annuity) — label, annualAmount, startAge, optional endAge, inflates. Do NOT extract salary / wages / working-years income.
- major expenses (kind "event"): label, eventKind (college | wedding | home | other), startYear (years from now), durationYears, annualCost
  - college: typically durationYears 4 and annualCost per year; link 529s via linkedCollegeLabel on the account
  - wedding / home / other: usually durationYears 1 where annualCost is the total one-shot cost
- personal milestones (kind "milestone"): labeled life markers that are NOT cost events — e.g. "Move to FL", "Paid off mortgage". Use label plus yearOffset (years from now) or age. Do not invent costs for these.

${IMPORT_COMPLETENESS_RULES}

AVAILABLE FUND OPTIONS (account.fund / defaultFund ids):
${fundOptionsPromptBlock()}
Mapping hints (closest match when confident):
- Bank checking, Cash Plus, PayPal, settlement / brokerage cash, bare "Cash" balances → checking (0%)
- Money market / T-bills / sweep / CMA → cash (~3.5%)
- 60/40, bond-heavy, conservative balanced → conservative
- 80/20, moderate balanced → moderate
- Heavy equity / aggressive growth (not a plain S&P/total-market fund) → aggressive
- S&P 500, SPY/VOO/VFIAX, total US stock market (VTI/VTSAX) → sp500
- Explicit expected return % with no clear preset → custom (+ customReturn decimal)

Matching / merge decisions (required for every item):
- You receive the current scenario with entity ids. YOU decide duplicates and merges — the client does no string/fuzzy matching.
- Set matchExistingId to the existing entity's id when the extracted item is clearly the same account/income/event/milestone (same person/owner and same instrument). Otherwise null.
- NEVER match solely because two accounts share a kind (Roth, Trad, 401k, etc.) or have similar balances. "Kevin Roth IRA" must NOT match "Allison Roth IRA".
- Different owners or differently named people stay separate even if both are Roth IRAs.
- For scalars: matchExistingId is always null. Use suggestedResolution "import" to apply, "keep" when equal to the current scenario value, or "skip".
- For list entities: suggestedResolution "replace" when matchExistingId is set, "add" when new, or "skip" to omit.
- matchExplanation is optional. Use ≤1 short clause ONLY when matchExistingId is set (e.g. "same owner + Roth IRA"). Empty/null/omit for new items — never write why something did not match.

Each item needs a brief explanation of the number (≤1 short clause: what source text/figure it came from). No essays.
Rates in valueLabel may show as percents (3%); scalar.value for inflation/withdrawPct/customReturn must be decimals.
For event startYear: if a calendar year is given, convert to years from the current calendar year (0 = this year).
If nothing useful is found, return an empty items array and a short summary.`;

/**
 * Compact fixture with early linked accounts and late named holdings (for chunk /
 * late-content unit tests). Content shape mirrors aggregator pastes; not a special path.
 */
export const IMPORT_LATE_CONTENT_FIXTURE = `Vanguard
Roth IRA — VTSAX  $450,000.00
Traditional IRA  $220,000.00
Brokerage  $80,000.00

Bank of America — My Financial Picture
401(k)  $310,000.00

Manual
ICON via Capital Factory  $100,000.00
Saronic via Capital Factory  $100,000.00
Commod - direct  $100,000.00
Everfence via Starbridge  $50,000.00
Etched via Starbridge  $75,000.00
Databricks via Starbridge  $100,000.00
Prometheus via Starbridge  $50,000.00
Legendary Ventures - Tech Opportunity Fund  $200,000.00
Untapped VC - direct  $75,000.00
Anthropic via Starbridge  $150,000.00
OpenAI via Starbridge  $300,000.00
E2B aka FoundryLabs - direct  $50,000.00
`;

/** Labels near the end of {@link IMPORT_LATE_CONTENT_FIXTURE} that must survive chunking. */
export const IMPORT_LATE_CONTENT_LABELS = [
  "Saronic via Capital Factory",
  "OpenAI via Starbridge",
  "Legendary Ventures - Tech Opportunity Fund",
  "ICON via Capital Factory",
  "Anthropic via Starbridge",
] as const;
