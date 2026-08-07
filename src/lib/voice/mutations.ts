import {
  DEFAULT_SCENARIO,
  FUND_OPTIONS,
  KIND_LABEL,
  clampCostBasisPct,
  fundRate,
  migrateScenario,
  newAccount,
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
import { US_STATES, type UsStateCode } from "@/lib/us-taxes";

function defaultEventForKind(
  kind: LifeEventKind,
  existing: LifeEvent[],
): Omit<LifeEvent, "id"> {
  const last = existing[existing.length - 1];
  const startYear = last
    ? last.startYear + Math.max(1, last.durationYears)
    : 2;
  switch (kind) {
    case "college":
      return {
        kind,
        label: `Kid ${existing.filter((e) => e.kind === "college").length + 1} college`,
        startYear,
        durationYears: 4,
        annualCost: 45_000,
      };
    case "wedding":
      return {
        kind,
        label: "Wedding",
        startYear,
        durationYears: 1,
        annualCost: 50_000,
      };
    case "home":
      return {
        kind,
        label: "Second home",
        startYear,
        durationYears: 1,
        annualCost: 200_000,
      };
    default:
      return {
        kind: "other",
        label: "Major expense",
        startYear,
        durationYears: 1,
        annualCost: 25_000,
      };
  }
}

export type VoiceMutationResult = {
  ok: boolean;
  /** False when proposed values already match live scenario state. */
  changed: boolean;
  scenario: ScenarioInput;
  summary: string;
  error?: string;
  /** data-voice-path values to flash after a successful edit. */
  highlightPaths?: string[];
  /** Human-readable field assignments that were applied. */
  changedFields?: string[];
  /** Human-readable field assignments that already matched. */
  alreadySet?: string[];
};

function ok(
  scenario: ScenarioInput,
  summary: string,
  highlightPaths?: string[],
  fieldMeta?: { changedFields?: string[]; alreadySet?: string[] },
): VoiceMutationResult {
  return {
    ok: true,
    changed: true,
    scenario,
    summary,
    ...(highlightPaths && highlightPaths.length > 0
      ? { highlightPaths }
      : {}),
    ...(fieldMeta?.changedFields && fieldMeta.changedFields.length > 0
      ? { changedFields: fieldMeta.changedFields }
      : {}),
    ...(fieldMeta?.alreadySet && fieldMeta.alreadySet.length > 0
      ? { alreadySet: fieldMeta.alreadySet }
      : {}),
  };
}

function already(
  scenario: ScenarioInput,
  message: string,
  alreadySet?: string[],
): VoiceMutationResult {
  return {
    ok: true,
    changed: false,
    scenario,
    summary: message,
    ...(alreadySet && alreadySet.length > 0 ? { alreadySet } : {}),
  };
}

function fail(
  scenario: ScenarioInput,
  error: string,
): VoiceMutationResult {
  return { ok: false, changed: false, scenario, summary: error, error };
}

function nearlyEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function moneyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return undefined;
}

function findByIdOrLabel<T extends { id: string; label: string }>(
  items: T[],
  id?: string,
  label?: string,
): T | undefined {
  if (id) {
    const byId = items.find((i) => i.id === id);
    if (byId) return byId;
  }
  if (label) {
    const needle = label.trim().toLowerCase();
    return items.find((i) => i.label.trim().toLowerCase() === needle);
  }
  return undefined;
}

function reorderByIds<T extends { id: string }>(
  items: T[],
  orderedIds: string[],
): T[] | null {
  if (orderedIds.length !== items.length) return null;
  const map = new Map(items.map((i) => [i.id, i]));
  const next: T[] = [];
  for (const id of orderedIds) {
    const item = map.get(id);
    if (!item) return null;
    next.push(item);
    map.delete(id);
  }
  if (map.size > 0) return null;
  return next;
}

const ACCOUNT_KINDS = new Set<AccountKind>([
  "taxable",
  "roth",
  "traditional",
  "401k",
  "529",
]);
const FUND_VALUES = new Set(FUND_OPTIONS.map((f) => f.value));
const EVENT_KINDS = new Set<LifeEventKind>([
  "college",
  "wedding",
  "home",
  "other",
]);
const SPEND_MODES = new Set<SpendMode>(["fixed", "percent"]);
const ORDERS = new Set<WithdrawOrder>([
  "taxable-trad-roth",
  "taxable-roth-trad",
  "pro-rata",
]);
const STATE_CODES = new Set(US_STATES.map((s) => s.code));

function parseAccountKind(value: unknown): AccountKind | undefined {
  const s = asString(value);
  return s && ACCOUNT_KINDS.has(s as AccountKind)
    ? (s as AccountKind)
    : undefined;
}

function parseFund(value: unknown): FundPreset | undefined {
  const s = asString(value);
  return s && FUND_VALUES.has(s as FundPreset) ? (s as FundPreset) : undefined;
}

function parseEventKind(value: unknown): LifeEventKind | undefined {
  const s = asString(value);
  return s && EVENT_KINDS.has(s as LifeEventKind)
    ? (s as LifeEventKind)
    : undefined;
}

/** Summarize scenario for the model (compact, id-addressable). */
export function summarizeScenario(scenario: ScenarioInput): Record<string, unknown> {
  return {
    age: scenario.age,
    endAge: scenario.endAge,
    inflationPct: Math.round(scenario.inflation * 10_000) / 100,
    spendMode: scenario.spendMode,
    annualSpend: scenario.annualSpend,
    withdrawPct: Math.round(scenario.withdrawPct * 10_000) / 100,
    order: scenario.order,
    modelTaxes: scenario.modelTaxes,
    stateCode: scenario.stateCode,
    taxableCostBasisPct:
      Math.round(clampCostBasisPct(scenario.taxableCostBasisPct) * 10_000) /
      100,
    defaultFund: scenario.defaultFund,
    accounts: scenario.accounts.map((a) => ({
      id: a.id,
      kind: a.kind,
      kindLabel: KIND_LABEL[a.kind],
      label: a.label,
      balance: a.balance,
      fund: a.fund,
      customReturnPct: Math.round(a.customReturn * 10_000) / 100,
      liquidFromYear: a.liquidFromYear,
      linkedEventId: a.linkedEventId,
    })),
    incomes: scenario.incomes.map((i) => ({
      id: i.id,
      label: i.label,
      annualAmount: i.annualAmount,
      startAge: i.startAge,
      endAge: i.endAge,
      inflates: i.inflates,
    })),
    events: scenario.events.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      startYear: e.startYear,
      durationYears: e.durationYears,
      annualCost: e.annualCost,
    })),
    personalMilestones: scenario.personalMilestones.map((m) => ({
      id: m.id,
      label: m.label,
      yearOffset: m.yearOffset,
    })),
  };
}

export function getScenarioTool(
  scenario: ScenarioInput,
): VoiceMutationResult {
  // Read-only — never mark as a mutation / UI change.
  return already(scenario, JSON.stringify(summarizeScenario(scenario)));
}

export function updateScenarioScalars(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const next: ScenarioInput = { ...scenario };
  const changed: string[] = [];
  const same: string[] = [];
  const paths: string[] = [];

  const age = asNumber(args.age);
  if (age !== undefined) {
    const v = Math.max(18, Math.round(age));
    if (v === scenario.age) same.push(`age=${scenario.age}`);
    else {
      next.age = v;
      changed.push(`age=${v}`);
      paths.push("age");
    }
  }
  const endAge = asNumber(args.endAge);
  if (endAge !== undefined) {
    const v = Math.max(next.age + 1, Math.round(endAge));
    if (v === scenario.endAge) same.push(`endAge=${scenario.endAge}`);
    else {
      next.endAge = v;
      changed.push(`endAge=${v}`);
      paths.push("endAge");
    }
  }
  const inflationPct = asNumber(args.inflationPct);
  if (inflationPct !== undefined) {
    const v = Math.max(0, inflationPct / 100);
    if (nearlyEqual(v, scenario.inflation)) {
      same.push(`inflation=${Math.round(scenario.inflation * 10_000) / 100}%`);
    } else {
      next.inflation = v;
      changed.push(`inflation=${inflationPct}%`);
      paths.push("inflation");
    }
  }
  const inflation = asNumber(args.inflation);
  if (inflation !== undefined && args.inflationPct === undefined) {
    const v = Math.max(0, inflation > 1 ? inflation / 100 : inflation);
    if (nearlyEqual(v, scenario.inflation)) {
      same.push(`inflation=${Math.round(scenario.inflation * 10_000) / 100}%`);
    } else {
      next.inflation = v;
      changed.push(`inflation=${Math.round(v * 10_000) / 100}%`);
      paths.push("inflation");
    }
  }
  const spendMode = asString(args.spendMode);
  if (spendMode && SPEND_MODES.has(spendMode as SpendMode)) {
    if (spendMode === scenario.spendMode) same.push(`spendMode=${spendMode}`);
    else {
      next.spendMode = spendMode as SpendMode;
      changed.push(`spendMode=${spendMode}`);
      paths.push("spendMode");
    }
  }
  const annualSpend = asNumber(args.annualSpend);
  if (annualSpend !== undefined) {
    const v = Math.max(0, annualSpend);
    if (moneyEqual(v, scenario.annualSpend)) {
      same.push(`annualSpend=${scenario.annualSpend}`);
    } else {
      next.annualSpend = v;
      changed.push(`annualSpend=${v}`);
      paths.push("annualSpend");
    }
  }
  const withdrawPct = asNumber(args.withdrawPct);
  if (withdrawPct !== undefined) {
    const v = Math.max(0, withdrawPct > 1 ? withdrawPct / 100 : withdrawPct);
    if (nearlyEqual(v, scenario.withdrawPct)) {
      same.push(
        `withdrawPct=${Math.round(scenario.withdrawPct * 10_000) / 100}%`,
      );
    } else {
      next.withdrawPct = v;
      changed.push(`withdrawPct=${Math.round(v * 10_000) / 100}%`);
      paths.push("withdrawPct");
    }
  }
  const order = asString(args.order);
  if (order && ORDERS.has(order as WithdrawOrder)) {
    if (order === scenario.order) same.push(`order=${order}`);
    else {
      next.order = order as WithdrawOrder;
      changed.push(`order=${order}`);
      paths.push("order");
    }
  }
  const modelTaxes = asBoolean(args.modelTaxes);
  if (modelTaxes !== undefined) {
    if (modelTaxes === scenario.modelTaxes) {
      same.push(`modelTaxes=${modelTaxes}`);
    } else {
      next.modelTaxes = modelTaxes;
      changed.push(`modelTaxes=${modelTaxes}`);
      paths.push("modelTaxes");
    }
  }
  const stateCode = asString(args.stateCode)?.toUpperCase();
  if (stateCode && STATE_CODES.has(stateCode as UsStateCode)) {
    if (stateCode === scenario.stateCode) same.push(`state=${stateCode}`);
    else {
      next.stateCode = stateCode as UsStateCode;
      changed.push(`state=${stateCode}`);
      paths.push("stateCode");
    }
  }
  const basisPct = asNumber(args.taxableCostBasisPct);
  if (basisPct !== undefined) {
    const v = clampCostBasisPct(basisPct > 1 ? basisPct / 100 : basisPct);
    if (nearlyEqual(v, clampCostBasisPct(scenario.taxableCostBasisPct))) {
      same.push(
        `basis=${Math.round(clampCostBasisPct(scenario.taxableCostBasisPct) * 10_000) / 100}%`,
      );
    } else {
      next.taxableCostBasisPct = v;
      changed.push(`basis=${Math.round(v * 10_000) / 100}%`);
      paths.push("taxableCostBasisPct");
    }
  }
  const defaultFund = parseFund(args.defaultFund);
  if (defaultFund) {
    if (defaultFund === scenario.defaultFund) {
      same.push(`defaultFund=${defaultFund}`);
    } else {
      next.defaultFund = defaultFund;
      changed.push(`defaultFund=${defaultFund}`);
      paths.push("defaultFund");
    }
  }

  if (changed.length === 0) {
    if (same.length === 0) {
      return fail(scenario, "No recognized scalar fields to update");
    }
    return already(scenario, `Already ${same.join(", ")}`, same);
  }
  return ok(next, `Updated ${changed.join(", ")}`, paths, {
    changedFields: changed,
    alreadySet: same,
  });
}

export function addAccount(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const kind = parseAccountKind(args.kind) ?? "taxable";
  let account = newAccount(kind, scenario);
  const label = asString(args.label);
  if (label) account = { ...account, label };
  const balance = asNumber(args.balance);
  if (balance !== undefined) account = { ...account, balance: Math.max(0, balance) };
  const fund = parseFund(args.fund);
  if (fund) {
    account = {
      ...account,
      fund,
      customReturn: fundRate(fund, account.customReturn),
    };
  }
  const customReturnPct = asNumber(args.customReturnPct);
  if (customReturnPct !== undefined) {
    account = {
      ...account,
      fund: "custom",
      customReturn: Math.max(0, customReturnPct / 100),
    };
  }
  const liquidFromYear = asNumber(args.liquidFromYear);
  if (liquidFromYear !== undefined) {
    account = {
      ...account,
      liquidFromYear:
        liquidFromYear <= 0 ? null : Math.round(liquidFromYear),
    };
  }
  const linkedEventId = asString(args.linkedEventId);
  if (linkedEventId !== undefined && kind === "529") {
    account = { ...account, linkedEventId: linkedEventId || null };
  }

  return ok(
    { ...scenario, accounts: [...scenario.accounts, account] },
    `Added account ${account.label} (${account.id})`,
    [`accounts.${account.id}`],
  );
}

export function updateAccount(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.accounts,
    asString(args.id),
    asString(args.matchLabel) ??
      (asString(args.id) ? undefined : asString(args.label)),
  );
  if (!target) return fail(scenario, "Account not found");

  const partial: Partial<Account> = {};
  const changed: string[] = [];
  const same: string[] = [];
  const paths: string[] = [];
  const base = `accounts.${target.id}`;

  const kind = parseAccountKind(args.kind);
  if (kind) {
    if (kind === target.kind) same.push(`kind=${kind}`);
    else {
      partial.kind = kind;
      changed.push(`kind=${kind}`);
      paths.push(`${base}.kind`);
    }
  }
  const rename =
    asString(args.newLabel) ??
    (asString(args.id) ? asString(args.label) : undefined);
  if (rename) {
    if (rename === target.label) same.push(`label=${rename}`);
    else {
      partial.label = rename;
      changed.push(`label=${rename}`);
      paths.push(`${base}.label`);
    }
  }

  const balance = asNumber(args.balance);
  if (balance !== undefined) {
    const v = Math.max(0, balance);
    if (moneyEqual(v, target.balance)) same.push(`balance=${target.balance}`);
    else {
      partial.balance = v;
      changed.push(`balance=${v}`);
      paths.push(`${base}.balance`);
    }
  }
  const fund = parseFund(args.fund);
  if (fund) {
    const nextReturn = fundRate(fund, target.customReturn);
    if (fund === target.fund && nearlyEqual(nextReturn, target.customReturn)) {
      same.push(`fund=${fund}`);
    } else {
      partial.fund = fund;
      partial.customReturn = nextReturn;
      changed.push(`fund=${fund}`);
      paths.push(`${base}.fund`);
    }
  }
  const customReturnPct = asNumber(args.customReturnPct);
  if (customReturnPct !== undefined) {
    const v = Math.max(0, customReturnPct / 100);
    if (
      target.fund === "custom" &&
      nearlyEqual(v, target.customReturn)
    ) {
      same.push(`customReturnPct=${customReturnPct}`);
    } else {
      partial.fund = "custom";
      partial.customReturn = v;
      changed.push(`customReturnPct=${customReturnPct}`);
      paths.push(`${base}.customReturn`);
    }
  }
  if ("liquidFromYear" in args) {
    const ly = asNumber(args.liquidFromYear);
    const v = ly === undefined || ly <= 0 ? null : Math.round(ly);
    if (v === target.liquidFromYear) {
      same.push(`liquidFromYear=${v ?? "now"}`);
    } else {
      partial.liquidFromYear = v;
      changed.push(`liquidFromYear=${v ?? "now"}`);
      paths.push(`${base}.liquidFromYear`);
    }
  }
  if ("linkedEventId" in args) {
    const linked = asString(args.linkedEventId);
    const v = linked || null;
    if (v === target.linkedEventId) {
      same.push(`linkedEventId=${v ?? "none"}`);
    } else {
      partial.linkedEventId = v;
      changed.push(`linkedEventId=${v ?? "none"}`);
      paths.push(`${base}.linkedEventId`);
    }
  }

  if (changed.length === 0) {
    if (same.length === 0) {
      return fail(scenario, "No recognized account fields to update");
    }
    return already(
      scenario,
      `Already ${same.join(", ")} for ${target.label}`,
      same.map((s) => `${target.label}: ${s}`),
    );
  }

  const nextAccounts = scenario.accounts.map((a) =>
    a.id === target.id ? { ...a, ...partial } : a,
  );
  return ok(
    { ...scenario, accounts: nextAccounts },
    `Updated account ${target.label} (${target.id}): ${changed.join(", ")}`,
    paths.length > 0 ? paths : [base],
    {
      changedFields: changed.map((s) => `${target.label}: ${s}`),
      alreadySet: same.map((s) => `${target.label}: ${s}`),
    },
  );
}

export function removeAccount(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.accounts,
    asString(args.id),
    asString(args.label),
  );
  if (!target) return fail(scenario, "Account not found");
  return ok(
    {
      ...scenario,
      accounts: scenario.accounts.filter((a) => a.id !== target.id),
    },
    `Removed account ${target.label}`,
  );
}

export function reorderAccounts(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args) || !Array.isArray(args.orderedIds)) {
    return fail(scenario, "orderedIds array required");
  }
  const orderedIds = args.orderedIds.filter(
    (id): id is string => typeof id === "string",
  );
  const next = reorderByIds(scenario.accounts, orderedIds);
  if (!next) return fail(scenario, "orderedIds must list every account id once");
  if (scenario.accounts.every((a, i) => a.id === orderedIds[i])) {
    return already(scenario, "Already in that account order");
  }
  return ok({ ...scenario, accounts: next }, "Reordered accounts");
}

export function addIncome(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const stream: IncomeStream = {
    id: uid("income"),
    label: asString(args.label) ?? "Income",
    annualAmount: Math.max(0, asNumber(args.annualAmount) ?? 0),
    startAge: Math.round(asNumber(args.startAge) ?? scenario.age),
    endAge:
      args.endAge === null || args.endAge === undefined
        ? null
        : Math.round(asNumber(args.endAge) ?? scenario.endAge),
    inflates: asBoolean(args.inflates) ?? true,
  };
  return ok(
    { ...scenario, incomes: [...scenario.incomes, stream] },
    `Added income ${stream.label} (${stream.id})`,
    [`incomes.${stream.id}`],
  );
}

export function updateIncome(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.incomes,
    asString(args.id),
    asString(args.label) ?? asString(args.matchLabel),
  );
  if (!target) return fail(scenario, "Income stream not found");

  const partial: Partial<IncomeStream> = {};
  const changed: string[] = [];
  const same: string[] = [];
  const paths: string[] = [];
  const base = `incomes.${target.id}`;

  const rename =
    asString(args.newLabel) ??
    (asString(args.id) ? asString(args.label) : undefined);
  if (rename) {
    if (rename === target.label) same.push(`label=${rename}`);
    else {
      partial.label = rename;
      changed.push(`label=${rename}`);
      paths.push(`${base}.label`);
    }
  }
  const annualAmount = asNumber(args.annualAmount);
  if (annualAmount !== undefined) {
    const v = Math.max(0, annualAmount);
    if (moneyEqual(v, target.annualAmount)) {
      same.push(`annualAmount=${target.annualAmount}`);
    } else {
      partial.annualAmount = v;
      changed.push(`annualAmount=${v}`);
      paths.push(`${base}.annualAmount`);
    }
  }
  const startAge = asNumber(args.startAge);
  if (startAge !== undefined) {
    const v = Math.round(startAge);
    if (v === target.startAge) same.push(`startAge=${v}`);
    else {
      partial.startAge = v;
      changed.push(`startAge=${v}`);
      paths.push(`${base}.startAge`);
    }
  }
  if ("endAge" in args) {
    const v =
      args.endAge === null ? null : Math.round(asNumber(args.endAge) ?? 0);
    if (v === target.endAge) same.push(`endAge=${v}`);
    else {
      partial.endAge = v;
      changed.push(`endAge=${v}`);
      paths.push(`${base}.endAge`);
    }
  }
  const inflates = asBoolean(args.inflates);
  if (inflates !== undefined) {
    if (inflates === target.inflates) same.push(`inflates=${inflates}`);
    else {
      partial.inflates = inflates;
      changed.push(`inflates=${inflates}`);
      paths.push(`${base}.inflates`);
    }
  }

  if (changed.length === 0) {
    if (same.length === 0) {
      return fail(scenario, "No recognized income fields to update");
    }
    return already(
      scenario,
      `Already ${same.join(", ")} for ${target.label}`,
      same.map((s) => `${target.label}: ${s}`),
    );
  }

  return ok(
    {
      ...scenario,
      incomes: scenario.incomes.map((i) =>
        i.id === target.id ? { ...i, ...partial } : i,
      ),
    },
    `Updated income ${target.label}: ${changed.join(", ")}`,
    paths.length > 0 ? paths : [base],
    {
      changedFields: changed.map((s) => `${target.label}: ${s}`),
      alreadySet: same.map((s) => `${target.label}: ${s}`),
    },
  );
}

export function removeIncome(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.incomes,
    asString(args.id),
    asString(args.label),
  );
  if (!target) return fail(scenario, "Income stream not found");
  return ok(
    {
      ...scenario,
      incomes: scenario.incomes.filter((i) => i.id !== target.id),
    },
    `Removed income ${target.label}`,
  );
}

export function reorderIncomes(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args) || !Array.isArray(args.orderedIds)) {
    return fail(scenario, "orderedIds array required");
  }
  const orderedIds = args.orderedIds.filter(
    (id): id is string => typeof id === "string",
  );
  const next = reorderByIds(scenario.incomes, orderedIds);
  if (!next) return fail(scenario, "orderedIds must list every income id once");
  if (scenario.incomes.every((a, i) => a.id === orderedIds[i])) {
    return already(scenario, "Already in that income order");
  }
  return ok({ ...scenario, incomes: next }, "Reordered income streams");
}

export function addEvent(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const kind = parseEventKind(args.kind) ?? "other";
  const id = uid("event");
  const defaults = defaultEventForKind(kind, scenario.events);
  const event: LifeEvent = {
    id,
    kind,
    label: asString(args.label) ?? defaults.label,
    startYear: Math.max(
      0,
      Math.round(asNumber(args.startYear) ?? defaults.startYear),
    ),
    durationYears: Math.max(
      1,
      Math.round(asNumber(args.durationYears) ?? defaults.durationYears),
    ),
    annualCost: Math.max(
      0,
      asNumber(args.annualCost) ?? defaults.annualCost,
    ),
  };
  return ok(
    { ...scenario, events: [...scenario.events, event] },
    `Added event ${event.label} (${event.id})`,
    [`events.${event.id}`],
  );
}

export function updateEvent(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.events,
    asString(args.id),
    asString(args.label) ?? asString(args.matchLabel),
  );
  if (!target) return fail(scenario, "Event not found");

  const partial: Partial<LifeEvent> = {};
  const changed: string[] = [];
  const same: string[] = [];
  const paths: string[] = [];
  const base = `events.${target.id}`;

  const kind = parseEventKind(args.kind);
  if (kind) {
    if (kind === target.kind) same.push(`kind=${kind}`);
    else {
      partial.kind = kind;
      changed.push(`kind=${kind}`);
      paths.push(`${base}.kind`);
    }
  }
  const rename =
    asString(args.newLabel) ??
    (asString(args.id) ? asString(args.label) : undefined);
  if (rename) {
    if (rename === target.label) same.push(`label=${rename}`);
    else {
      partial.label = rename;
      changed.push(`label=${rename}`);
      paths.push(`${base}.label`);
    }
  }
  const startYear = asNumber(args.startYear);
  if (startYear !== undefined) {
    const v = Math.max(0, Math.round(startYear));
    if (v === target.startYear) same.push(`startYear=${v}`);
    else {
      partial.startYear = v;
      changed.push(`startYear=${v}`);
      paths.push(`${base}.startYear`);
    }
  }
  const durationYears = asNumber(args.durationYears);
  if (durationYears !== undefined) {
    const v = Math.max(1, Math.round(durationYears));
    if (v === target.durationYears) same.push(`durationYears=${v}`);
    else {
      partial.durationYears = v;
      changed.push(`durationYears=${v}`);
      paths.push(`${base}.durationYears`);
    }
  }
  const annualCost = asNumber(args.annualCost);
  if (annualCost !== undefined) {
    const v = Math.max(0, annualCost);
    if (moneyEqual(v, target.annualCost)) {
      same.push(`annualCost=${target.annualCost}`);
    } else {
      partial.annualCost = v;
      changed.push(`annualCost=${v}`);
      paths.push(`${base}.annualCost`);
    }
  }

  if (changed.length === 0) {
    if (same.length === 0) {
      return fail(scenario, "No recognized event fields to update");
    }
    return already(
      scenario,
      `Already ${same.join(", ")} for ${target.label}`,
      same.map((s) => `${target.label}: ${s}`),
    );
  }

  return ok(
    {
      ...scenario,
      events: scenario.events.map((e) =>
        e.id === target.id ? { ...e, ...partial } : e,
      ),
    },
    `Updated event ${target.label}: ${changed.join(", ")}`,
    paths.length > 0 ? paths : [base],
    {
      changedFields: changed.map((s) => `${target.label}: ${s}`),
      alreadySet: same.map((s) => `${target.label}: ${s}`),
    },
  );
}

export function removeEvent(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.events,
    asString(args.id),
    asString(args.label),
  );
  if (!target) return fail(scenario, "Event not found");
  return ok(
    {
      ...scenario,
      events: scenario.events.filter((e) => e.id !== target.id),
      accounts: scenario.accounts.map((a) =>
        a.linkedEventId === target.id ? { ...a, linkedEventId: null } : a,
      ),
    },
    `Removed event ${target.label}`,
  );
}

export function reorderEvents(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args) || !Array.isArray(args.orderedIds)) {
    return fail(scenario, "orderedIds array required");
  }
  const orderedIds = args.orderedIds.filter(
    (id): id is string => typeof id === "string",
  );
  const next = reorderByIds(scenario.events, orderedIds);
  if (!next) return fail(scenario, "orderedIds must list every event id once");
  if (scenario.events.every((a, i) => a.id === orderedIds[i])) {
    return already(scenario, "Already in that event order");
  }
  return ok({ ...scenario, events: next }, "Reordered events");
}

export function link529(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const eventId = asString(args.eventId);
  if (!eventId) return fail(scenario, "eventId required");
  const event = scenario.events.find((e) => e.id === eventId);
  if (!event) return fail(scenario, "Event not found");
  const accountId = asString(args.accountId);
  if (accountId) {
    const acct = scenario.accounts.find((a) => a.id === accountId);
    if (!acct || acct.kind !== "529") {
      return fail(scenario, "accountId must be a 529 account");
    }
  }

  const nextAccounts = scenario.accounts.map((a) => {
    if (a.kind !== "529") return a;
    if (!accountId) {
      return a.linkedEventId === eventId ? { ...a, linkedEventId: null } : a;
    }
    if (a.id === accountId) return { ...a, linkedEventId: eventId };
    if (a.linkedEventId === eventId) return { ...a, linkedEventId: null };
    return a;
  });

  const unchanged = nextAccounts.every(
    (a, i) =>
      a.linkedEventId === scenario.accounts[i]?.linkedEventId &&
      a.id === scenario.accounts[i]?.id,
  );
  if (unchanged) {
    return already(
      scenario,
      accountId
        ? `Already linked 529 ${accountId} to ${event.label}`
        : `Already no 529 link for ${event.label}`,
    );
  }

  return ok(
    { ...scenario, accounts: nextAccounts },
    accountId
      ? `Linked 529 ${accountId} to ${event.label}`
      : `Cleared 529 link for ${event.label}`,
  );
}

export function addPersonalMilestone(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const yearOffset = Math.min(
    Math.max(0, scenario.endAge - scenario.age),
    Math.round(
      asNumber(args.yearOffset) ?? (scenario.endAge - scenario.age) / 3,
    ),
  );
  const milestone: PersonalMilestone = {
    id: uid("milestone"),
    label: asString(args.label) ?? "Personal milestone",
    yearOffset,
  };
  return ok(
    {
      ...scenario,
      personalMilestones: [...scenario.personalMilestones, milestone],
    },
    `Added milestone ${milestone.label}`,
  );
}

export function updatePersonalMilestone(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.personalMilestones,
    asString(args.id),
    asString(args.label) ?? asString(args.matchLabel),
  );
  if (!target) return fail(scenario, "Milestone not found");
  const partial: Partial<PersonalMilestone> = {};
  const changed: string[] = [];
  const same: string[] = [];

  const rename =
    asString(args.newLabel) ??
    (asString(args.id) ? asString(args.label) : undefined);
  if (rename) {
    if (rename === target.label) same.push(`label=${rename}`);
    else {
      partial.label = rename;
      changed.push(`label=${rename}`);
    }
  }
  const yearOffset = asNumber(args.yearOffset);
  if (yearOffset !== undefined) {
    const v = Math.max(0, Math.round(yearOffset));
    if (v === target.yearOffset) same.push(`yearOffset=${v}`);
    else {
      partial.yearOffset = v;
      changed.push(`yearOffset=${v}`);
    }
  }

  if (changed.length === 0) {
    if (same.length === 0) {
      return fail(scenario, "No recognized milestone fields to update");
    }
    return already(
      scenario,
      `Already ${same.join(", ")} for ${target.label}`,
      same.map((s) => `${target.label}: ${s}`),
    );
  }

  return ok(
    {
      ...scenario,
      personalMilestones: scenario.personalMilestones.map((m) =>
        m.id === target.id ? { ...m, ...partial } : m,
      ),
    },
    `Updated milestone ${target.label}: ${changed.join(", ")}`,
    undefined,
    {
      changedFields: changed.map((s) => `${target.label}: ${s}`),
      alreadySet: same.map((s) => `${target.label}: ${s}`),
    },
  );
}

export function removePersonalMilestone(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const target = findByIdOrLabel(
    scenario.personalMilestones,
    asString(args.id),
    asString(args.label),
  );
  if (!target) return fail(scenario, "Milestone not found");
  return ok(
    {
      ...scenario,
      personalMilestones: scenario.personalMilestones.filter(
        (m) => m.id !== target.id,
      ),
    },
    `Removed milestone ${target.label}`,
  );
}

const SCALAR_PATHS = new Set([
  "age",
  "endAge",
  "inflation",
  "inflationPct",
  "spendMode",
  "annualSpend",
  "withdrawPct",
  "order",
  "modelTaxes",
  "stateCode",
  "state",
  "taxableCostBasisPct",
  "defaultFund",
]);

/**
 * Apply one data-voice-path style change: `age`, `accounts.<id>.balance`, etc.
 * Optional matchLabel resolves accounts/incomes/events/milestones when id unknown.
 */
function applyPathChange(
  scenario: ScenarioInput,
  change: Record<string, unknown>,
): VoiceMutationResult {
  const path = asString(change.path);
  if (!path) return fail(scenario, "changes[].path required");
  if (!("value" in change)) return fail(scenario, `No value for path ${path}`);

  const value = change.value;
  const matchLabel = asString(change.matchLabel);

  if (SCALAR_PATHS.has(path) || path === "state") {
    const key = path === "state" ? "stateCode" : path;
    return updateScenarioScalars(scenario, { [key]: value });
  }

  const parts = path.split(".");
  if (parts.length < 2) {
    return fail(scenario, `Unrecognized path: ${path}`);
  }

  const [collection, idOrLabel, field] = parts;
  if (collection === "accounts") {
    if (!field) {
      return fail(
        scenario,
        "Account path needs a field, e.g. accounts.<id>.balance",
      );
    }
    const byId = scenario.accounts.find((a) => a.id === idOrLabel);
    const args: Record<string, unknown> = {
      [field === "customReturn" ? "customReturnPct" : field]: value,
    };
    if (field === "label") args.newLabel = asString(value);
    if (byId) args.id = idOrLabel;
    else if (matchLabel) args.matchLabel = matchLabel;
    else args.matchLabel = idOrLabel;
    return updateAccount(scenario, args);
  }
  if (collection === "incomes") {
    if (!field) {
      return fail(
        scenario,
        "Income path needs a field, e.g. incomes.<id>.annualAmount",
      );
    }
    const byId = scenario.incomes.find((i) => i.id === idOrLabel);
    const args: Record<string, unknown> = { [field]: value };
    if (field === "label") args.newLabel = asString(value);
    if (byId) args.id = idOrLabel;
    else if (matchLabel) args.matchLabel = matchLabel;
    else args.matchLabel = idOrLabel;
    return updateIncome(scenario, args);
  }
  if (collection === "events") {
    if (!field) {
      return fail(
        scenario,
        "Event path needs a field, e.g. events.<id>.annualCost",
      );
    }
    if (field === "linked529") {
      return link529(scenario, {
        eventId: idOrLabel,
        accountId: value === null || value === "" ? "" : String(value),
      });
    }
    const byId = scenario.events.find((e) => e.id === idOrLabel);
    const args: Record<string, unknown> = { [field]: value };
    if (field === "label") args.newLabel = asString(value);
    if (byId) args.id = idOrLabel;
    else if (matchLabel) args.matchLabel = matchLabel;
    else args.matchLabel = idOrLabel;
    return updateEvent(scenario, args);
  }
  if (collection === "personalMilestones" || collection === "milestones") {
    if (!field) {
      return fail(
        scenario,
        "Milestone path needs a field, e.g. personalMilestones.<id>.yearOffset",
      );
    }
    const byId = scenario.personalMilestones.find((m) => m.id === idOrLabel);
    const args: Record<string, unknown> = { [field]: value };
    if (field === "label") args.newLabel = asString(value);
    if (byId) args.id = idOrLabel;
    else if (matchLabel) args.matchLabel = matchLabel;
    else args.matchLabel = idOrLabel;
    return updatePersonalMilestone(scenario, args);
  }

  return fail(scenario, `Unrecognized path: ${path}`);
}

function mergeMutationIntoBatch(
  working: ScenarioInput,
  result: VoiceMutationResult,
  changedFields: string[],
  alreadySet: string[],
  paths: string[],
  errors: string[],
): ScenarioInput {
  if (!result.ok) {
    errors.push(result.error ?? result.summary);
    return working;
  }
  if (result.changedFields?.length) {
    changedFields.push(...result.changedFields);
  } else if (result.changed) {
    changedFields.push(result.summary);
  }
  if (result.alreadySet?.length) {
    alreadySet.push(...result.alreadySet);
  } else if (!result.changed && result.summary.startsWith("Already ")) {
    alreadySet.push(result.summary.slice("Already ".length));
  }
  if (result.highlightPaths?.length) {
    paths.push(...result.highlightPaths);
  }
  return result.changed ? result.scenario : working;
}

/**
 * Apply multiple independent edits in one mutation: scenario scalars,
 * per-row account/income/event/milestone patches, and/or path/value changes.
 * Flashes every changed path once; reports per-field changed vs already-set.
 */
export function batchUpdate(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");

  const changedFields: string[] = [];
  const alreadySet: string[] = [];
  const paths: string[] = [];
  const errors: string[] = [];
  let working = scenario;
  let appliedAny = false;

  if (isRecord(args.scenario)) {
    const keys = Object.keys(args.scenario);
    if (keys.length > 0) {
      appliedAny = true;
      working = mergeMutationIntoBatch(
        working,
        updateScenarioScalars(working, args.scenario),
        changedFields,
        alreadySet,
        paths,
        errors,
      );
    }
  }

  const accountPatches = Array.isArray(args.accounts) ? args.accounts : [];
  for (const patch of accountPatches) {
    if (!isRecord(patch)) {
      errors.push("accounts[] entries must be objects");
      continue;
    }
    appliedAny = true;
    working = mergeMutationIntoBatch(
      working,
      updateAccount(working, patch),
      changedFields,
      alreadySet,
      paths,
      errors,
    );
  }

  const incomePatches = Array.isArray(args.incomes) ? args.incomes : [];
  for (const patch of incomePatches) {
    if (!isRecord(patch)) {
      errors.push("incomes[] entries must be objects");
      continue;
    }
    appliedAny = true;
    working = mergeMutationIntoBatch(
      working,
      updateIncome(working, patch),
      changedFields,
      alreadySet,
      paths,
      errors,
    );
  }

  const eventPatches = Array.isArray(args.events) ? args.events : [];
  for (const patch of eventPatches) {
    if (!isRecord(patch)) {
      errors.push("events[] entries must be objects");
      continue;
    }
    appliedAny = true;
    working = mergeMutationIntoBatch(
      working,
      updateEvent(working, patch),
      changedFields,
      alreadySet,
      paths,
      errors,
    );
  }

  const milestonePatches = Array.isArray(args.milestones)
    ? args.milestones
    : Array.isArray(args.personalMilestones)
      ? args.personalMilestones
      : [];
  for (const patch of milestonePatches) {
    if (!isRecord(patch)) {
      errors.push("milestones[] entries must be objects");
      continue;
    }
    appliedAny = true;
    working = mergeMutationIntoBatch(
      working,
      updatePersonalMilestone(working, patch),
      changedFields,
      alreadySet,
      paths,
      errors,
    );
  }

  const pathChanges = Array.isArray(args.changes) ? args.changes : [];
  for (const change of pathChanges) {
    if (!isRecord(change)) {
      errors.push("changes[] entries must be objects");
      continue;
    }
    appliedAny = true;
    working = mergeMutationIntoBatch(
      working,
      applyPathChange(working, change),
      changedFields,
      alreadySet,
      paths,
      errors,
    );
  }

  if (!appliedAny) {
    return fail(
      scenario,
      "batch_update requires scenario, accounts, incomes, events, milestones, and/or changes",
    );
  }

  if (changedFields.length === 0 && errors.length === 0) {
    return already(
      scenario,
      alreadySet.length > 0
        ? `Already ${alreadySet.join("; ")}`
        : "Already set — nothing to change",
      alreadySet,
    );
  }

  if (changedFields.length === 0 && errors.length > 0) {
    return fail(scenario, errors.join("; "));
  }

  const summaryParts = [
    `Updated ${changedFields.join(", ")}`,
    alreadySet.length > 0 ? `Already ${alreadySet.join("; ")}` : null,
    errors.length > 0 ? `Errors: ${errors.join("; ")}` : null,
  ].filter(Boolean);

  return ok(working, summaryParts.join(". "), [...new Set(paths)], {
    changedFields,
    alreadySet,
  });
}

export function resetScenario(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  const confirmed =
    isRecord(args) && asBoolean(args.confirmed) === true;
  if (!confirmed) {
    return fail(
      scenario,
      "Reset requires confirmed=true after the user agrees",
    );
  }
  if (
    JSON.stringify(summarizeScenario(scenario)) ===
    JSON.stringify(summarizeScenario(DEFAULT_SCENARIO))
  ) {
    return already(scenario, "Already on the default starter scenario");
  }
  return ok(DEFAULT_SCENARIO, "Reset to default starter scenario");
}

export function replaceScenario(
  scenario: ScenarioInput,
  args: unknown,
): VoiceMutationResult {
  if (!isRecord(args)) return fail(scenario, "Invalid arguments");
  const confirmed = asBoolean(args.confirmed) === true;
  if (!confirmed) {
    return fail(
      scenario,
      "replace_scenario requires confirmed=true",
    );
  }
  const raw = args.scenario;
  if (!raw) return fail(scenario, "scenario object required");
  const next = migrateScenario(raw);
  return ok(next, "Replaced full scenario");
}
