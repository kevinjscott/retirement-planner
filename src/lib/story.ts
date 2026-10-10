import {
  DEFAULT_SCENARIO,
  FUND_PRESETS,
  deflateToToday,
  isCollegeEvent,
  newAccount,
  uid,
  type Account,
  type AccountKind,
  type FundPreset,
  type IncomeStream,
  type LifeEvent,
  type LifeEventKind,
  type ScenarioInput,
  type YearRow,
} from "@/lib/projection";

/** Savings buckets as the story presents them (pretax folds Trad IRA + 401(k)). */
export type Pot = "taxable" | "roth" | "pretax" | "education";

export const POT_KINDS: Record<Pot, AccountKind[]> = {
  taxable: ["taxable"],
  roth: ["roth"],
  pretax: ["traditional", "401k"],
  education: ["529"],
};

export const POT_ORDER: Pot[] = ["taxable", "pretax", "roth", "education"];

export const POT_COPY: Record<
  Pot,
  { title: string; taxNote: string; example: string }
> = {
  taxable: {
    title: "Brokerage and savings",
    taxNote: "Taxed only on the gains when you sell",
    example: "Brokerage, savings, CDs",
  },
  pretax: {
    title: "Traditional IRA and 401(k)",
    taxNote: "Every dollar out is taxed as income",
    example: "Pre-tax retirement accounts",
  },
  roth: {
    title: "Roth IRA and Roth 401(k)",
    taxNote: "Withdrawals come out tax-free",
    example: "After-tax retirement accounts",
  },
  education: {
    title: "529 college savings",
    taxNote: "Tax-free when spent on college",
    example: "Set aside for tuition",
  },
};

/** Where the story starts for someone building their own plan. */
export const BLANK_START_SCENARIO: ScenarioInput = {
  ...DEFAULT_SCENARIO,
  accounts: [],
  incomes: [],
  events: [],
  personalMilestones: [],
};

export function potAccounts(scenario: ScenarioInput, pot: Pot): Account[] {
  const kinds = POT_KINDS[pot];
  return scenario.accounts.filter((a) => kinds.includes(a.kind));
}

export function potBalance(scenario: ScenarioInput, pot: Pot): number {
  return potAccounts(scenario, pot).reduce((s, a) => s + a.balance, 0);
}

/**
 * Set one bucket's total. Existing accounts scale together so any per-account
 * mix the user already has survives; an empty bucket gets a fresh account.
 */
export function setPotBalance(
  scenario: ScenarioInput,
  pot: Pot,
  amount: number,
): ScenarioInput {
  const next = Math.max(0, Math.round(amount));
  const existing = potAccounts(scenario, pot);
  if (existing.length === 0) {
    if (next === 0) return scenario;
    const kind = POT_KINDS[pot][0]!;
    const account = { ...newAccount(kind, scenario), balance: next };
    return normalize529Links({
      ...scenario,
      accounts: [...scenario.accounts, account],
    });
  }
  const current = existing.reduce((s, a) => s + a.balance, 0);
  const ids = new Set(existing.map((a) => a.id));
  const first = existing[0]!.id;
  return {
    ...scenario,
    accounts: scenario.accounts.map((a) => {
      if (!ids.has(a.id)) return a;
      if (current <= 0) {
        return a.id === first ? { ...a, balance: next } : a;
      }
      return { ...a, balance: Math.round((a.balance / current) * next) };
    }),
  };
}

export type RiskStyle = "steady" | "balanced" | "growth";

export const RISK_FUND: Record<RiskStyle, Exclude<FundPreset, "custom">> = {
  steady: "conservative",
  balanced: "moderate",
  growth: "aggressive",
};

export const RISK_COPY: Record<RiskStyle, { label: string; blurb: string }> = {
  steady: { label: "Steady", blurb: "60/40 mix" },
  balanced: { label: "Balanced", blurb: "80/20 mix" },
  growth: { label: "Growth", blurb: "Heavy equity" },
};

export function riskRate(style: RiskStyle): number {
  return FUND_PRESETS[RISK_FUND[style]].rate;
}

/** The style every investable account already matches, if there is one. */
export function currentRiskStyle(scenario: ScenarioInput): RiskStyle | null {
  const investable = scenario.accounts.filter((a) => a.kind !== "529");
  const styles = (Object.keys(RISK_FUND) as RiskStyle[]).filter((s) =>
    investable.length > 0
      ? investable.every((a) => a.fund === RISK_FUND[s])
      : scenario.defaultFund === RISK_FUND[s],
  );
  return styles[0] ?? null;
}

export function applyRiskStyle(
  scenario: ScenarioInput,
  style: RiskStyle,
): ScenarioInput {
  const fund = RISK_FUND[style];
  const customReturn = FUND_PRESETS[fund].rate;
  return {
    ...scenario,
    defaultFund: fund,
    accounts: scenario.accounts.map((a) =>
      a.kind === "529" ? a : { ...a, fund, customReturn },
    ),
  };
}

/** Link orphaned 529s to a college event, one each where possible. */
export function normalize529Links(scenario: ScenarioInput): ScenarioInput {
  const colleges = scenario.events.filter((e) => isCollegeEvent(e));
  if (colleges.length === 0) return scenario;
  const taken = new Set(
    scenario.accounts
      .filter((a) => a.kind === "529" && a.linkedEventId)
      .map((a) => a.linkedEventId as string),
  );
  const free = colleges.filter((e) => !taken.has(e.id));
  let changed = false;
  const accounts = scenario.accounts.map((a) => {
    if (a.kind !== "529") return a;
    const valid =
      a.linkedEventId != null &&
      scenario.events.some((e) => e.id === a.linkedEventId);
    if (valid) return a;
    changed = true;
    const pick = free.shift() ?? colleges[0]!;
    return { ...a, linkedEventId: pick.id };
  });
  return changed ? { ...scenario, accounts } : scenario;
}

/** Drop buckets the user never filled in before handing off to the planner. */
export function pruneEmptyAccounts(scenario: ScenarioInput): ScenarioInput {
  const accounts = scenario.accounts.filter((a) => a.balance > 0);
  if (accounts.length === scenario.accounts.length) return scenario;
  return { ...scenario, accounts };
}

export function finalizeStoryScenario(scenario: ScenarioInput): ScenarioInput {
  return normalize529Links(pruneEmptyAccounts(scenario));
}

export type IncomePreset = "social-security" | "pension" | "rental" | "other";

export const INCOME_PRESET_COPY: Record<
  IncomePreset,
  { label: string; blurb: string }
> = {
  "social-security": {
    label: "Social Security",
    blurb: "Waiting until 70 pays the most per year",
  },
  pension: { label: "Pension", blurb: "Fixed income for life" },
  rental: { label: "Rental income", blurb: "Starts now, keeps pace with prices" },
  other: { label: "Other income", blurb: "Part-time work, annuity, royalties" },
};

export function newIncome(
  preset: IncomePreset,
  scenario: Pick<ScenarioInput, "age" | "endAge">,
): IncomeStream {
  const clampAge = (n: number) =>
    Math.max(scenario.age, Math.min(scenario.endAge, n));
  switch (preset) {
    case "social-security":
      return {
        id: uid("ss"),
        label: "Social Security",
        annualAmount: 36_000,
        startAge: clampAge(67),
        endAge: null,
        inflates: true,
      };
    case "pension":
      return {
        id: uid("pension"),
        label: "Pension",
        annualAmount: 24_000,
        startAge: clampAge(65),
        endAge: null,
        inflates: false,
      };
    case "rental":
      return {
        id: uid("rental"),
        label: "Rental income",
        annualAmount: 18_000,
        startAge: scenario.age,
        endAge: null,
        inflates: true,
      };
    default:
      return {
        id: uid("income"),
        label: "Other income",
        annualAmount: 12_000,
        startAge: clampAge(scenario.age + 2),
        endAge: null,
        inflates: true,
      };
  }
}

export const STORY_EVENT_COPY: Record<
  LifeEventKind,
  { label: string; blurb: string }
> = {
  college: { label: "College", blurb: "Four years of tuition and living costs" },
  wedding: { label: "Wedding", blurb: "One big bill in a single year" },
  home: { label: "Home project", blurb: "Renovation, a new roof, a second home" },
  other: { label: "Something else", blurb: "Medical, a gift, a long trip" },
};

export function newStoryEvent(
  kind: LifeEventKind,
  scenario: Pick<ScenarioInput, "age" | "endAge" | "events">,
): LifeEvent {
  const horizon = Math.max(1, scenario.endAge - scenario.age);
  const sameKind = scenario.events.filter((e) => e.kind === kind).length;
  const startYear = Math.min(horizon - 1, 2 + sameKind * 2);
  switch (kind) {
    case "college":
      return {
        id: uid("event"),
        kind,
        label: `Kid ${sameKind + 1} college`,
        startYear,
        durationYears: 4,
        annualCost: 45_000,
      };
    case "wedding":
      return {
        id: uid("event"),
        kind,
        label: "Wedding",
        startYear,
        durationYears: 1,
        annualCost: 35_000,
      };
    case "home":
      return {
        id: uid("event"),
        kind,
        label: "Home project",
        startYear,
        durationYears: 1,
        annualCost: 60_000,
      };
    default:
      return {
        id: uid("event"),
        kind,
        label: "Big expense",
        startYear,
        durationYears: 1,
        annualCost: 25_000,
      };
  }
}

export type YearBar = {
  year: number;
  age: number;
  living: number;
  events: number;
  income: number;
  /** Spend the year's income pays for. */
  covered: number;
  /** Spend that has to come out of savings. */
  fromSavings: number;
};

/** Per-year need vs income in then-dollars. Spans the planned horizon even if funds run out. */
export function buildYearBars(
  scenario: ScenarioInput,
  rows: YearRow[],
): YearBar[] {
  const horizon = Math.max(1, scenario.endAge - scenario.age);
  const byYear = new Map(rows.map((r) => [r.year, r]));
  const baseLiving =
    scenario.spendMode === "percent"
      ? scenario.accounts
          .filter((a) => a.kind !== "529")
          .reduce((s, a) => s + a.balance, 0) * scenario.withdrawPct
      : scenario.annualSpend;
  const bars: YearBar[] = [];
  for (let y = 0; y <= horizon; y++) {
    const age = scenario.age + y;
    const row = byYear.get(y);
    const inflate = Math.pow(1 + scenario.inflation, y);
    const living = row ? row.living : baseLiving * inflate;
    const events = row
      ? row.eventCost
      : scenario.events.reduce(
          (s, ev) =>
            y >= ev.startYear && y < ev.startYear + ev.durationYears
              ? s + ev.annualCost * inflate
              : s,
          0,
        );
    const income = row
      ? row.income
      : scenario.incomes.reduce((s, inc) => {
          if (age < inc.startAge) return s;
          if (inc.endAge != null && age > inc.endAge) return s;
          return s + inc.annualAmount * (inc.inflates ? inflate : 1);
        }, 0);
    const need = living + events;
    const covered = Math.min(income, need);
    bars.push({
      year: y,
      age,
      living,
      events,
      income,
      covered,
      fromSavings: need - covered,
    });
  }
  return bars;
}

export type Verdict = {
  depleted: boolean;
  /** Age at which savings reach zero. */
  runOutAge: number | null;
  endAge: number;
  endingToday: number;
  startTotal: number;
  avgDrawToday: number;
  taxesToday: number;
  /** Years of today's spend the starting balance covers with no growth. */
  yearsOfRunway: number | null;
};

export function buildVerdict(
  scenario: ScenarioInput,
  rows: YearRow[],
): Verdict {
  const depletedRow = rows.find((r) => r.total < 1 && r.year > 0);
  const last = rows[rows.length - 1];
  const startTotal = scenario.accounts.reduce((s, a) => s + a.balance, 0);
  const draws = rows.filter((r) => r.withdrawn > 0);
  const avgDrawToday =
    draws.length === 0
      ? 0
      : draws.reduce(
          (s, r) => s + deflateToToday(r.withdrawn, scenario.inflation, r.year),
          0,
        ) / draws.length;
  const taxesToday = rows.reduce(
    (s, r) => s + deflateToToday(r.taxes, scenario.inflation, r.year),
    0,
  );
  const spend =
    scenario.spendMode === "percent"
      ? startTotal * scenario.withdrawPct
      : scenario.annualSpend;
  return {
    depleted: depletedRow != null,
    runOutAge: depletedRow ? depletedRow.age : null,
    endAge: scenario.endAge,
    endingToday: last
      ? deflateToToday(last.total, scenario.inflation, last.year)
      : 0,
    startTotal,
    avgDrawToday,
    taxesToday,
    yearsOfRunway: spend > 0 ? startTotal / spend : null,
  };
}

export type StoryEra = {
  id: string;
  label: string;
  age: number;
  detail: string;
};

/** Ages where the rules of the game change, for the lifeline. */
export function lifeEras(scenario: Pick<ScenarioInput, "age" | "endAge">): StoryEra[] {
  const all: StoryEra[] = [
    {
      id: "penalty-free",
      label: "Penalty-free withdrawals",
      age: 59.5,
      detail:
        "Before this, taking money out of a Traditional IRA or 401(k) costs an extra 10%.",
    },
    {
      id: "medicare",
      label: "Medicare",
      age: 65,
      detail: "You become eligible for Medicare, which changes health costs.",
    },
    {
      id: "social-security",
      label: "Full Social Security",
      age: 67,
      detail:
        "Full retirement age for anyone born in 1960 or later. Claiming earlier pays less.",
    },
    {
      id: "rmd",
      label: "Required withdrawals",
      age: 73,
      detail:
        "The IRS makes you start drawing down Traditional accounts, whether you need the money or not.",
    },
  ];
  return all.filter((e) => e.age > scenario.age && e.age < scenario.endAge);
}

/**
 * US CPI-U annual-average change, rounded. For reference only: past
 * inflation does not predict future inflation.
 */
export const INFLATION_HISTORY: { id: string; label: string; rate: number; note: string }[] = [
  { id: "1970s", label: "1970s", rate: 0.071, note: "Oil shocks" },
  { id: "1980s", label: "1980s", rate: 0.056, note: "Peaked at 13.5% in 1980" },
  { id: "1990s", label: "1990s", rate: 0.03, note: "" },
  { id: "2000s", label: "2000s", rate: 0.026, note: "" },
  { id: "2010s", label: "2010s", rate: 0.018, note: "Below the 2% target" },
  { id: "2020-23", label: "2020 to 2023", rate: 0.045, note: "8.0% in 2022" },
];

/** Federal Reserve long-run goal, and a common planning default. */
export const INFLATION_TARGET = 0.02;
