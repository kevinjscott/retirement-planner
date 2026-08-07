import type {
  Account,
  IncomeStream,
  LifeEvent,
  PersonalMilestone,
  ScenarioInput,
} from "@/lib/projection";

/** Max undo snapshots retained (present is separate). */
export const SCENARIO_HISTORY_LIMIT = 50;

/** Typing coalesce window — successive edits to the same paths merge into one undo step. */
export const SCENARIO_HISTORY_COALESCE_MS = 400;

const SCALAR_KEYS = [
  "age",
  "endAge",
  "defaultFund",
  "inflation",
  "spendMode",
  "annualSpend",
  "withdrawPct",
  "order",
  "modelTaxes",
  "federalRate",
  "stateCode",
  "taxableCostBasisPct",
] as const satisfies ReadonlyArray<keyof ScenarioInput>;

const ACCOUNT_FIELDS = [
  "kind",
  "label",
  "balance",
  "fund",
  "customReturn",
  "linkedEventId",
  "liquidFromYear",
] as const satisfies ReadonlyArray<keyof Account>;

const INCOME_FIELDS = [
  "label",
  "annualAmount",
  "startAge",
  "endAge",
  "inflates",
] as const satisfies ReadonlyArray<keyof IncomeStream>;

const EVENT_FIELDS = [
  "kind",
  "label",
  "startYear",
  "durationYears",
  "annualCost",
] as const satisfies ReadonlyArray<keyof LifeEvent>;

const MILESTONE_FIELDS = [
  "label",
  "yearOffset",
] as const satisfies ReadonlyArray<keyof PersonalMilestone>;

export function cloneScenario(scenario: ScenarioInput): ScenarioInput {
  return structuredClone(scenario);
}

export function scenariosEqual(a: ScenarioInput, b: ScenarioInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function samePathSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((p) => set.has(p));
}

export function sameChangedPaths(a: string[], b: string[]): boolean {
  return samePathSet(a, b);
}

function pushUnique(out: string[], path: string) {
  if (!out.includes(path)) out.push(path);
}

function diffKeyedList<T extends { id: string }>(
  before: T[],
  after: T[],
  collection: string,
  fields: ReadonlyArray<keyof T>,
  out: string[],
) {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));

  for (const [id, prev] of beforeById) {
    const next = afterById.get(id);
    const base = `${collection}.${id}`;
    if (!next) {
      pushUnique(out, base);
      continue;
    }
    let fieldChanged = false;
    for (const field of fields) {
      if (prev[field] !== next[field]) {
        pushUnique(out, `${base}.${String(field)}`);
        fieldChanged = true;
      }
    }
    if (!fieldChanged) {
      const prevIndex = before.findIndex((item) => item.id === id);
      const nextIndex = after.findIndex((item) => item.id === id);
      if (prevIndex !== nextIndex) pushUnique(out, base);
    }
  }

  for (const [id] of afterById) {
    if (!beforeById.has(id)) {
      pushUnique(out, `${collection}.${id}`);
    }
  }
}

/**
 * Returns `data-voice-path` values that differ between two scenario snapshots.
 * Used to flash the same highlights as Voice mutations after undo/redo.
 */
export function diffScenarioPaths(
  before: ScenarioInput,
  after: ScenarioInput,
): string[] {
  if (before === after) return [];
  const out: string[] = [];

  for (const key of SCALAR_KEYS) {
    if (before[key] !== after[key]) pushUnique(out, key);
  }

  diffKeyedList(before.accounts, after.accounts, "accounts", ACCOUNT_FIELDS, out);
  // UI tags the event-side control as events.{id}.linked529 (not accounts.*.linkedEventId).
  for (const afterAcct of after.accounts) {
    const beforeAcct = before.accounts.find((a) => a.id === afterAcct.id);
    if (!beforeAcct) continue;
    if (beforeAcct.linkedEventId === afterAcct.linkedEventId) continue;
    if (beforeAcct.linkedEventId) {
      pushUnique(out, `events.${beforeAcct.linkedEventId}.linked529`);
    }
    if (afterAcct.linkedEventId) {
      pushUnique(out, `events.${afterAcct.linkedEventId}.linked529`);
    }
  }
  diffKeyedList(before.incomes, after.incomes, "incomes", INCOME_FIELDS, out);
  diffKeyedList(before.events, after.events, "events", EVENT_FIELDS, out);
  diffKeyedList(
    before.personalMilestones,
    after.personalMilestones,
    "personalMilestones",
    MILESTONE_FIELDS,
    out,
  );

  return out;
}
