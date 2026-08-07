import {
  combinedCapitalGainsRate,
  combinedPretaxRate,
  effectiveTaxableWithdrawRate,
  estimateFederalLtcgRate,
  estimateFederalOrdinaryRate,
  type UsStateCode,
} from "./us-taxes";

export type AccountKind = "taxable" | "roth" | "traditional" | "401k" | "529";
export type FundPreset =
  | "checking"
  | "cash"
  | "conservative"
  | "moderate"
  | "aggressive"
  | "sp500"
  | "custom";

export type Account = {
  id: string;
  kind: AccountKind;
  label: string;
  balance: number;
  fund: FundPreset;
  customReturn: number;
  /** For 529s: grow until this linked college event ends, paying it first. */
  linkedEventId: string | null;
  /**
   * Calendar year when this account becomes drawable for living spend.
   * `null` = liquid now. Projection skips the account until that year.
   */
  liquidFromYear: number | null;
};

export type LifeEventKind = "college" | "wedding" | "home" | "other";

export type LifeEvent = {
  id: string;
  kind: LifeEventKind;
  label: string;
  /** Years from now (0 = current calendar year). */
  startYear: number;
  /** 1 = one-shot (cost is the total); >1 = multi-year (cost is per year). */
  durationYears: number;
  /**
   * Cost per year in today's dollars; inflated by `inflation` each projection year.
   * For durationYears === 1 this is the total cost.
   */
  annualCost: number;
};

export const EVENT_KIND_LABEL: Record<LifeEventKind, string> = {
  college: "College",
  wedding: "Wedding",
  home: "Home",
  other: "Other",
};

export function isCollegeEvent(ev: Pick<LifeEvent, "kind">): boolean {
  return ev.kind === "college";
}

export type IncomeStream = {
  id: string;
  label: string;
  /** Annual amount in today's dollars; grows with inflation only when `inflates`. */
  annualAmount: number;
  startAge: number;
  endAge: number | null;
  inflates: boolean;
};

export type SpendMode = "fixed" | "percent";
export type WithdrawOrder = "taxable-trad-roth" | "taxable-roth-trad" | "pro-rata";

/**
 * User-authored timeline markers (persisted).
 * `yearOffset` matches LifeEvent.startYear: 0 = current calendar year.
 */
export type PersonalMilestone = {
  id: string;
  label: string;
  yearOffset: number;
};

/**
 * Default RMD start age (SECURE 2.0: age 73 for many currently retiring;
 * later cohorts move to 75). This app models RMDs from 73 — not tax advice.
 */
export const RMD_DEFAULT_AGE = 73;

/** IRS penalty-free retirement withdrawal age (mark near the year you turn 59½). */
export const PENALTY_FREE_AGE = 59.5;

/** Extra 10% IRS early-withdrawal penalty on pretax draws before 59½ (when taxes are modeled). */
export const EARLY_WITHDRAWAL_PENALTY = 0.1;

/** Medicare eligibility age. */
export const MEDICARE_AGE = 65;

/**
 * IRS Uniform Lifetime Table (Table III) distribution periods by attained age.
 * Source: Treas. Reg. §1.401(a)(9)-9(c) / IRS Pub. 590-B Appendix B
 * (distribution calendar years beginning on or after Jan 1, 2022).
 * RMD ≈ prior year-end pretax balance ÷ factor for the age you turn this year.
 */
export const UNIFORM_LIFETIME_FACTORS: Readonly<Record<number, number>> = {
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
};

/** Distribution period for `age` from the Uniform Lifetime Table. */
export function uniformLifetimeFactor(age: number): number {
  if (!Number.isFinite(age) || age < 72) return UNIFORM_LIFETIME_FACTORS[72]!;
  if (age >= 120) return UNIFORM_LIFETIME_FACTORS[120]!;
  const exact = UNIFORM_LIFETIME_FACTORS[Math.floor(age)];
  if (exact != null) return exact;
  return UNIFORM_LIFETIME_FACTORS[120]!;
}

/** True when any Trad IRA / 401(k) balance is positive. */
export function hasPretaxBalance(accounts: Account[]): boolean {
  return accounts.some((a) => isPreTax(a.kind) && a.balance > 0);
}

/** Sum of Traditional + 401(k) balances. */
export function pretaxBalanceTotal(accounts: Account[]): number {
  return accounts
    .filter((a) => isPreTax(a.kind))
    .reduce((s, a) => s + a.balance, 0);
}

/**
 * Required minimum distribution for the year you turn `age`.
 * Uses prior year-end pretax balance (this model's start-of-year balances) ÷
 * Uniform Lifetime factor. Zero before {@link RMD_DEFAULT_AGE}.
 */
export function computeRmd(pretaxBalance: number, age: number): number {
  if (age < RMD_DEFAULT_AGE || pretaxBalance <= 0) return 0;
  return pretaxBalance / uniformLifetimeFactor(age);
}

export type TimelineMilestoneKind =
  | "income"
  | "rmd"
  | "event"
  | "bucket"
  | "depletion"
  | "life"
  | "draw"
  | "pinch"
  | "personal";

/** End-of-year balance treated as exhausted (matches funds-run-out threshold). */
const DEPLETED_BALANCE = 1;

/** Derived + personal markers for the compact milestones timeline. */
export type TimelineMilestone = {
  id: string;
  kind: TimelineMilestoneKind;
  label: string;
  detail: string;
  yearOffset: number;
  age: number;
  calendarYear: number;
  /**
   * Multi-year span on the timeline (college / multi-year expenses).
   * Omit or 1 = point marker; >1 = start→end range bar.
   */
  durationYears?: number;
  /** Source row id for income / event / personal markers. */
  sourceId?: string;
};

function isPreTax(kind: AccountKind): boolean {
  return kind === "traditional" || kind === "401k";
}

/** Checking / money-market style funds — treated as ~100% basis (no CG). */
function isCashLikeFund(fund: FundPreset): boolean {
  return fund === "checking" || fund === "cash";
}

export type ScenarioInput = {
  age: number;
  endAge: number;
  accounts: Account[];
  incomes: IncomeStream[];
  defaultFund: FundPreset;
  inflation: number;
  spendMode: SpendMode;
  /** Fixed annual living spend in today's dollars; inflated each projection year. */
  annualSpend: number;
  /** First-year withdraw rate of investable balances; that $ base then inflates yearly. */
  withdrawPct: number;
  events: LifeEvent[];
  /** User-labeled personal markers on the milestones timeline. */
  personalMilestones: PersonalMilestone[];
  order: WithdrawOrder;
  modelTaxes: boolean;
  /**
   * Cached federal ordinary rate for export / older saves.
   * Live projections ignore this and call `resolveFederalRate` / `estimateFederalOrdinaryRate`.
   */
  federalRate: number;
  /** US state/DC of residence for state income tax on pre-tax withdrawals. */
  stateCode: UsStateCode;
  /**
   * Cost basis as a fraction of taxable *investment* balances (0–1).
   * Gain fraction ≈ 1 − this. Checking/cash funds are always 100% basis.
   * Default 0.5 (half basis / half unrealized gain).
   */
  taxableCostBasisPct: number;
};

export type YearRow = {
  year: number;
  age: number;
  taxable: number;
  retirement: number;
  /** Roth IRA / Roth 401(k) portion of `retirement` (end of year, after growth). */
  roth: number;
  education: number;
  total: number;
  /** Gross portfolio draws funding living/events (excludes RMD excess rolled to taxable). */
  withdrawn: number;
  /** Gross withdrawn from taxable brokerage this year (spend draws). */
  withdrawnTaxable: number;
  /**
   * Gross withdrawn from Trad/401(k) this year (spend draws + full RMD gross).
   * Includes RMD excess that is rolled to taxable after tax.
   */
  withdrawnPretax: number;
  /** Gross withdrawn from Roth IRA / Roth 401(k) this year (spend draws). */
  withdrawnRoth: number;
  /**
   * Gross RMD taken from Trad/401(k) this year (0 before RMD age).
   * Included in `withdrawnPretax`. Portion applied to spend is also in `withdrawn`;
   * excess net-of-tax is moved into taxable brokerage.
   */
  rmd: number;
  /** All major-event costs this year (college, wedding, home, other). */
  eventCost: number;
  /** Portion of college-kind events paid from linked 529s. */
  eventFrom529: number;
  /** College-kind costs only (for 529 coverage insight). */
  collegeCost: number;
  living: number;
  income: number;
  /**
   * Estimated taxes paid via withdrawal gross-up this year
   * (pretax ordinary + taxable brokerage LTCG + early-withdrawal penalty when modeled).
   * 0 when modelTaxes is off.
   */
  taxes: number;
  /**
   * Unmet net spend after draws from liquid accounts (0 = fully funded).
   * Illiquid balances are not raided to cover this.
   */
  shortfall: number;
  /** End-of-year taxable balances that are liquid this calendar year. */
  liquidTaxable: number;
  /** End-of-year Trad IRA / 401(k) balances liquid this calendar year. */
  liquidPretax: number;
  /** End-of-year Roth balances liquid this calendar year. */
  liquidRoth: number;
  /** End-of-year 529 balances liquid this calendar year. */
  liquidEducation: number;
};

/**
 * Explain a year's portfolio draw from existing row fields (no extra projection state).
 * `taxGrossUp` is implied: gross withdrawn above the net spend need after income/529s
 * (same quantity as `r.taxes` when taxes were recorded during projection).
 * Source buckets sum to spend-funding draws plus any RMD excess in pretax.
 */
export function portfolioDrawParts(r: YearRow): {
  living: number;
  eventShortfall: number;
  income: number;
  netNeed: number;
  taxGrossUp: number;
  withdrawn: number;
  withdrawnTaxable: number;
  withdrawnPretax: number;
  withdrawnRoth: number;
} {
  const eventShortfall = Math.max(0, r.eventCost - r.eventFrom529);
  const netNeed = Math.max(0, r.living + eventShortfall - r.income);
  const taxGrossUp =
    r.taxes != null && r.taxes > 0
      ? r.taxes
      : Math.max(0, r.withdrawn - netNeed);
  return {
    living: r.living,
    eventShortfall,
    income: r.income,
    netNeed,
    taxGrossUp,
    withdrawn: r.withdrawn,
    withdrawnTaxable: r.withdrawnTaxable,
    withdrawnPretax: r.withdrawnPretax,
    withdrawnRoth: r.withdrawnRoth,
  };
}

export const KIND_LABEL: Record<AccountKind, string> = {
  taxable: "Taxable",
  roth: "Roth",
  traditional: "Traditional",
  "401k": "401(k)",
  "529": "529",
};

/** Net-worth buckets for the balances summary (today's $). */
export type NetWorthBucketId =
  | "cash"
  | "taxable"
  | "retirement"
  | "education";

export type NetWorthBucket = {
  id: NetWorthBucketId;
  label: string;
  amount: number;
};

const NET_WORTH_BUCKET_META: {
  id: NetWorthBucketId;
  label: string;
}[] = [
  { id: "cash", label: "Cash / checking" },
  { id: "taxable", label: "Taxable" },
  { id: "retirement", label: "Retirement" },
  { id: "education", label: "529" },
];

/**
 * Sum balances into Cash (checking/cash fund), Taxable, Retirement
 * (Roth + Trad + 401k), and 529. Liquid funds win over kind.
 */
export function netWorthBreakdown(accounts: Account[]): {
  total: number;
  buckets: NetWorthBucket[];
} {
  const amounts: Record<NetWorthBucketId, number> = {
    cash: 0,
    taxable: 0,
    retirement: 0,
    education: 0,
  };

  for (const a of accounts) {
    const bal = a.balance;
    if (!Number.isFinite(bal) || bal === 0) continue;
    if (a.fund === "checking" || a.fund === "cash") {
      amounts.cash += bal;
    } else if (a.kind === "taxable") {
      amounts.taxable += bal;
    } else if (a.kind === "529") {
      amounts.education += bal;
    } else {
      amounts.retirement += bal;
    }
  }

  const total =
    amounts.cash + amounts.taxable + amounts.retirement + amounts.education;
  const buckets = NET_WORTH_BUCKET_META.map(({ id, label }) => ({
    id,
    label,
    amount: amounts[id],
  })).filter((b) => b.amount > 0);

  return { total, buckets };
}

export const FUND_PRESETS: Record<
  Exclude<FundPreset, "custom">,
  { label: string; rate: number; blurb: string }
> = {
  checking: { label: "Cash / checking", rate: 0, blurb: "0%" },
  cash: { label: "Money market / T-bills", rate: 0.035, blurb: "~3.5%" },
  conservative: { label: "60/40", rate: 0.055, blurb: "~5.5%" },
  moderate: { label: "80/20", rate: 0.07, blurb: "~7%" },
  aggressive: { label: "Heavy equity", rate: 0.085, blurb: "~8.5%" },
  sp500: { label: "S&P 500-ish", rate: 0.1, blurb: "~10%" },
};

export const FUND_OPTIONS: { value: FundPreset; label: string }[] = [
  { value: "checking", label: "Cash / checking (0%)" },
  { value: "cash", label: "Money market / T-bills (3.5%)" },
  { value: "conservative", label: "60/40 (5.5%)" },
  { value: "moderate", label: "80/20 (7%)" },
  { value: "aggressive", label: "Heavy equity (8.5%)" },
  { value: "sp500", label: "S&P 500-ish (10%)" },
  { value: "custom", label: "Custom rate" },
];

export function fundRate(fund: FundPreset, customReturn: number): number {
  if (fund === "custom") return customReturn;
  return FUND_PRESETS[fund].rate;
}

/** Federal ordinary rate used for pretax gross-up (always estimated from the scenario). */
export function resolveFederalRate(
  params: Pick<
    ScenarioInput,
    | "age"
    | "spendMode"
    | "annualSpend"
    | "withdrawPct"
    | "accounts"
    | "incomes"
  >,
): number {
  return estimateFederalOrdinaryRate(params);
}

export function effectivePretaxRate(
  params: Pick<
    ScenarioInput,
    | "age"
    | "spendMode"
    | "annualSpend"
    | "withdrawPct"
    | "accounts"
    | "incomes"
    | "stateCode"
  >,
): number {
  return combinedPretaxRate(resolveFederalRate(params), params.stateCode).combined;
}

/** Federal LTCG preferential rate for taxable-brokerage gross-up. */
export function resolveFederalLtcgRate(
  params: Pick<
    ScenarioInput,
    | "age"
    | "spendMode"
    | "annualSpend"
    | "withdrawPct"
    | "accounts"
    | "incomes"
  >,
): number {
  return estimateFederalLtcgRate(params);
}

/** Combined federal + state rate on the *gain portion* of taxable withdrawals. */
export function effectiveCapitalGainsRate(
  params: Pick<
    ScenarioInput,
    | "age"
    | "spendMode"
    | "annualSpend"
    | "withdrawPct"
    | "accounts"
    | "incomes"
    | "stateCode"
  >,
): number {
  return combinedCapitalGainsRate(
    resolveFederalLtcgRate(params),
    params.stateCode,
  ).combined;
}

/** Clamp cost-basis fraction to [0, 1]. */
export function clampCostBasisPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0.5;
  return Math.max(0, Math.min(1, pct));
}

export const DEFAULT_SCENARIO: ScenarioInput = {
  age: 58,
  endAge: 95,
  defaultFund: "moderate",
  accounts: [
    {
      id: "taxable-1",
      kind: "taxable",
      label: "Brokerage",
      balance: 400_000,
      fund: "moderate",
      customReturn: 0.07,
      linkedEventId: null,
      liquidFromYear: null,
    },
    {
      id: "roth-1",
      kind: "roth",
      label: "Roth IRA",
      balance: 350_000,
      fund: "sp500",
      customReturn: 0.1,
      linkedEventId: null,
      liquidFromYear: null,
    },
    {
      id: "trad-1",
      kind: "traditional",
      label: "Traditional IRA",
      balance: 650_000,
      fund: "moderate",
      customReturn: 0.07,
      linkedEventId: null,
      liquidFromYear: null,
    },
    {
      id: "529-1",
      kind: "529",
      label: "Kid 1 529",
      balance: 80_000,
      fund: "aggressive",
      customReturn: 0.085,
      linkedEventId: "kid-1",
      liquidFromYear: null,
    },
    {
      id: "529-2",
      kind: "529",
      label: "Kid 2 529",
      balance: 60_000,
      fund: "aggressive",
      customReturn: 0.085,
      linkedEventId: "kid-2",
      liquidFromYear: null,
    },
  ],
  incomes: [
    {
      id: "ss-1",
      label: "Social Security",
      annualAmount: 36_000,
      startAge: 67,
      endAge: null,
      inflates: true,
    },
  ],
  inflation: 0.03,
  spendMode: "fixed",
  annualSpend: 90_000,
  withdrawPct: 0.04,
  events: [
    {
      id: "kid-1",
      kind: "college",
      label: "Kid 1 college",
      startYear: 2,
      durationYears: 4,
      annualCost: 45_000,
    },
    {
      id: "kid-2",
      kind: "college",
      label: "Kid 2 college",
      startYear: 4,
      durationYears: 4,
      annualCost: 45_000,
    },
  ],
  personalMilestones: [],
  order: "taxable-trad-roth",
  modelTaxes: true,
  federalRate: 0.22,
  stateCode: "FL",
  taxableCostBasisPct: 0.5,
};

function clampYearOffset(
  offset: number,
  age: number,
  endAge: number,
): number {
  const horizon = Math.max(0, endAge - age);
  return Math.max(0, Math.min(horizon, Math.round(offset)));
}

/**
 * First year a bucket ends near $0 after having had a balance, while `stillHas`
 * remains true (e.g. taxable emptied but retirement accounts remain).
 */
function firstBucketDepletionYear(
  rows: YearRow[],
  initialBalance: number,
  getBucket: (r: YearRow) => number,
  stillHas: (r: YearRow) => boolean,
): YearRow | undefined {
  let prior = initialBalance;
  for (const row of rows) {
    const bal = getBucket(row);
    if (
      prior >= DEPLETED_BALANCE &&
      bal < DEPLETED_BALANCE &&
      stillHas(row)
    ) {
      return row;
    }
    prior = bal;
  }
  return undefined;
}

const DRAW_ORDER_SHORT: Record<WithdrawOrder, string> = {
  "taxable-trad-roth": "Taxable→Pretax→Roth",
  "taxable-roth-trad": "Taxable→Roth→Pretax",
  "pro-rata": "pro-rata",
};

/** Compact gross-up status for milestone detail copy. */
function grossUpDetail(scenario: ScenarioInput): string {
  if (!scenario.modelTaxes) return "gross-up is off";
  const pretaxPct = Math.round(effectivePretaxRate(scenario) * 100);
  const cgPct = Math.round(effectiveCapitalGainsRate(scenario) * 100);
  const basisPct = Math.round(
    clampCostBasisPct(scenario.taxableCostBasisPct) * 100,
  );
  return `gross-up is on (pretax ~${pretaxPct}%; taxable CG ~${cgPct}% on gains, basis ${basisPct}%)`;
}

function initTaxableBasis(
  accounts: Account[],
  costBasisPct: number,
): Map<string, number> {
  const pct = clampCostBasisPct(costBasisPct);
  const map = new Map<string, number>();
  for (const a of accounts) {
    if (a.kind !== "taxable") continue;
    if (isCashLikeFund(a.fund)) {
      map.set(a.id, Math.max(0, a.balance));
    } else {
      map.set(a.id, Math.max(0, a.balance) * pct);
    }
  }
  return map;
}

function gainFracForAccount(
  acct: Account,
  basisById: Map<string, number>,
): number {
  if (acct.kind !== "taxable" || isCashLikeFund(acct.fund)) return 0;
  const bal = acct.balance;
  if (bal <= 0) return 0;
  const basis = Math.min(Math.max(0, basisById.get(acct.id) ?? 0), bal);
  return Math.max(0, Math.min(1, 1 - basis / bal));
}

function moneyToday(
  nominal: number,
  inflation: number,
  yearOffset: number,
): string {
  return fmtMoney(deflateToToday(nominal, inflation, yearOffset), true);
}

/**
 * Build auto + personal timeline markers for the scenario.
 * Auto: income starts, penalty-free pretax (59½) / Medicare, first pretax draw, RMD,
 * taxable/529/Roth bucket depletion, liquidity pinch / shortfall, funds-run-out.
 * Detail strings lead with scenario implications (ages/years, today's $, selections).
 */
export function buildTimelineMilestones(
  scenario: ScenarioInput,
  rows: YearRow[],
  calendarStartYear: number,
): TimelineMilestone[] {
  const { age, endAge, accounts, incomes, events, personalMilestones } =
    scenario;
  const horizon = Math.max(0, endAge - age);
  const out: TimelineMilestone[] = [];
  const orderLabel = DRAW_ORDER_SHORT[scenario.order];
  const grossUp = grossUpDetail(scenario);
  const inflation = scenario.inflation;

  for (const inc of incomes) {
    const yearOffset = clampYearOffset(inc.startAge - age, age, endAge);
    if (inc.startAge < age || inc.startAge > endAge) continue;
    const calYear = calendarStartYear + yearOffset;
    const startRow = rows.find((r) => r.year === yearOffset);
    const livingBit = startRow
      ? ` Living that year ~${moneyToday(startRow.living, inflation, yearOffset)}.`
      : "";
    const inflateBit = inc.inflates ? " (inflates)" : "";
    out.push({
      id: `income-${inc.id}`,
      kind: "income",
      label: inc.label || "Retirement income",
      detail:
        `Adds ${fmtMoney(inc.annualAmount, true)}/yr from age ${inc.startAge} (${calYear})${inflateBit} — ` +
        `reducing what the portfolio must cover.` +
        livingBit,
      yearOffset,
      age: age + yearOffset,
      calendarYear: calYear,
      sourceId: inc.id,
    });
  }

  const hasRetirementAccounts = accounts.some(
    (a) =>
      (a.kind === "roth" || isPreTax(a.kind)) && a.balance > DEPLETED_BALANCE,
  );
  const hasPretax = hasPretaxBalance(accounts);
  const firstPretax = rows.find((r) => r.withdrawnPretax > DEPLETED_BALANCE);
  const penaltyFreeMarkAge = Math.floor(PENALTY_FREE_AGE);
  const penaltyModeled = scenario.modelTaxes;

  // Penalty-free pretax (59½) — taxable bridge + early-withdrawal framing.
  if (
    hasRetirementAccounts &&
    age < PENALTY_FREE_AGE &&
    PENALTY_FREE_AGE <= endAge
  ) {
    if (penaltyFreeMarkAge >= age && penaltyFreeMarkAge <= endAge) {
      const yearOffset = clampYearOffset(
        penaltyFreeMarkAge - age,
        age,
        endAge,
      );
      const calYear = calendarStartYear + yearOffset;
      const bridgeBit =
        ` Until then, living spend must be bridged from liquid taxable (and Roth if in draw order) ` +
        `without relying on penalty-free Trad/401(k).`;
      let detail: string;
      if (!hasPretax) {
        detail =
          `No Trad/401(k) in the plan — this unlock doesn't change withdrawals (${calYear}).`;
      } else if (!firstPretax) {
        detail =
          `You don't tap Trad/401(k) in this horizon — so the 10% early-withdrawal penalty ` +
          `never applies under this plan (${calYear}).${bridgeBit} — not tax advice.`;
      } else if (firstPretax.age < penaltyFreeMarkAge) {
        const penaltyBit = penaltyModeled
          ? `those withdrawals include a modeled 10% early-withdrawal penalty in tax gross-up`
          : `those withdrawals may face a 10% early-withdrawal penalty (turn tax estimate on to model it in $)`;
        detail =
          `You start pretax draws at age ${firstPretax.age} — before 59½ — so ${penaltyBit} ` +
          `(${calYear}).${bridgeBit} — not tax advice.`;
      } else if (firstPretax.age > penaltyFreeMarkAge) {
        detail =
          `You don't tap Trad/401(k) until age ${firstPretax.age} — after 59½ — so the ` +
          `early-withdrawal penalty never applies under this plan (${calYear}).${bridgeBit} — not tax advice.`;
      } else {
        const timingBit = penaltyModeled
          ? `early-withdrawal risk depends on timing within the year (penalty modeled for ages before 59½)`
          : `early-withdrawal risk depends on timing within the year (not modeled by month)`;
        detail =
          `You start pretax draws at age ${firstPretax.age} — the year you turn 59½ (${calYear}) — ` +
          `so ${timingBit}.${bridgeBit} — not tax advice.`;
      }
      out.push({
        id: "life-59-5",
        kind: "life",
        label: "Pretax unlock (59½)",
        detail,
        yearOffset,
        age: age + yearOffset,
        calendarYear: calYear,
      });
    }
  }

  if (age < MEDICARE_AGE && MEDICARE_AGE <= endAge) {
    const yearOffset = clampYearOffset(MEDICARE_AGE - age, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const row = rows.find((r) => r.year === yearOffset);
    const nestBit = row
      ? ` Nest egg then ~${moneyToday(row.total, inflation, yearOffset)} today's $;` +
        ` living ~${moneyToday(row.living, inflation, yearOffset)}.`
      : "";
    out.push({
      id: "life-medicare",
      kind: "life",
      label: "Medicare starts",
      detail:
        `Medicare eligibility typically starts at ${MEDICARE_AGE} (${calYear}) — ` +
        `premiums aren't a separate line here, so fold Part B/D (and Medigap if any) ` +
        `into living spend.${nestBit}`,
      yearOffset,
      age: age + yearOffset,
      calendarYear: calYear,
    });
  }

  if (hasPretax && RMD_DEFAULT_AGE >= age && RMD_DEFAULT_AGE <= endAge) {
    const yearOffset = clampYearOffset(RMD_DEFAULT_AGE - age, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const rmdRow = rows.find((r) => r.age === RMD_DEFAULT_AGE);
    const rmdNominal = rmdRow?.rmd ?? 0;
    const rmdToday = deflateToToday(rmdNominal, inflation, yearOffset);
    const factor = uniformLifetimeFactor(RMD_DEFAULT_AGE);
    const detail =
      rmdToday > 0
        ? `From age ${RMD_DEFAULT_AGE} (${calYear}) you must take Trad/401(k) RMDs — ` +
          `first year ~${fmtMoney(rmdToday, true)} today's $ (Uniform Lifetime ÷ ${factor}). ` +
          `Excess above spend rolls to taxable; ${grossUp}. — not tax advice.`
        : `No Trad/401(k) left by age ${RMD_DEFAULT_AGE} (${calYear}) — ` +
          `RMDs don't bite here (Roth has no RMD).`;
    out.push({
      id: "rmd-default",
      kind: "rmd",
      label: "RMD starts",
      detail,
      yearOffset,
      age: age + yearOffset,
      calendarYear: calYear,
    });
  }

  // First Trad/401(k) draw — skip when it coincides with the RMD marker.
  const rmdYearOffset =
    hasPretax && RMD_DEFAULT_AGE >= age && RMD_DEFAULT_AGE <= endAge
      ? clampYearOffset(RMD_DEFAULT_AGE - age, age, endAge)
      : null;
  if (
    firstPretax &&
    (rmdYearOffset == null || firstPretax.year !== rmdYearOffset)
  ) {
    const yearOffset = clampYearOffset(firstPretax.year, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const markAge = age + yearOffset;
    const drawToday = moneyToday(
      firstPretax.withdrawnPretax,
      inflation,
      yearOffset,
    );
    const livingBit = moneyToday(firstPretax.living, inflation, yearOffset);
    let penaltyBit: string;
    if (markAge < penaltyFreeMarkAge) {
      penaltyBit = penaltyModeled
        ? `Before 59½, so a 10% early-withdrawal penalty is included in tax gross-up. `
        : `Before 59½, so a 10% early-withdrawal penalty may apply (turn tax estimate on to model it). `;
    } else if (markAge > penaltyFreeMarkAge) {
      penaltyBit =
        `After 59½, so no early-withdrawal penalty under this plan. `;
    } else {
      penaltyBit = penaltyModeled
        ? `Around 59½ — early-withdrawal risk depends on timing within the year (penalty modeled before 59½). `
        : `Around 59½ — early-withdrawal risk depends on timing within the year (not modeled by month). `;
    }
    out.push({
      id: "draw-pretax",
      kind: "draw",
      label: "First draw from pretax accounts",
      detail:
        `You open Trad/401(k) at age ${markAge} (${calYear}) · ~${drawToday} today's $. ` +
        penaltyBit +
        `Living ~${livingBit}; ${orderLabel}; ${grossUp}.`,
      yearOffset,
      age: markAge,
      calendarYear: calYear,
    });
  }

  for (const ev of events) {
    const yearOffset = clampYearOffset(ev.startYear, age, endAge);
    const startAge = age + yearOffset;
    const calYear = calendarStartYear + yearOffset;
    const durationYears = Math.max(1, Math.round(ev.durationYears));
    const endAgeAt = startAge + durationYears - 1;
    const endCal = calYear + durationYears - 1;
    const costToday = fmtMoney(ev.annualCost, true);
    const dur =
      durationYears > 1
        ? ` · ${durationYears} yrs (ages ${startAge}–${endAgeAt}, ${calYear}–${endCal})`
        : ` · age ${startAge} (${calYear})`;
    const linked529 = accounts
      .filter((a) => a.kind === "529" && a.linkedEventId === ev.id)
      .reduce((s, a) => s + a.balance, 0);
    const linkedBit =
      isCollegeEvent(ev) && linked529 > 0
        ? ` Linked 529 now ${fmtMoney(linked529, true)}.`
        : "";
    out.push({
      id: `event-${ev.id}`,
      kind: "event",
      label: ev.label || EVENT_KIND_LABEL[ev.kind],
      detail: `${EVENT_KIND_LABEL[ev.kind]} · ${costToday}/yr${dur}.${linkedBit}`,
      yearOffset,
      age: startAge,
      calendarYear: calYear,
      ...(durationYears > 1 ? { durationYears } : {}),
      sourceId: ev.id,
    });
  }

  const initialTaxable = accounts
    .filter((a) => a.kind === "taxable")
    .reduce((s, a) => s + a.balance, 0);
  const taxableDepleted = firstBucketDepletionYear(
    rows,
    initialTaxable,
    (r) => r.taxable,
    (r) => r.retirement >= DEPLETED_BALANCE,
  );
  if (taxableDepleted) {
    const yearOffset = clampYearOffset(taxableDepleted.year, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const markAge = age + yearOffset;
    const livingBit = moneyToday(taxableDepleted.living, inflation, yearOffset);
    const nextBucket =
      scenario.order === "taxable-roth-trad" ? "Roth/pretax" : "pretax/Roth";
    out.push({
      id: "bucket-taxable",
      kind: "bucket",
      label: "Taxable depleted",
      detail:
        `Taxable hits $0 at age ${markAge} (${calYear}) — further spending draws from ` +
        `${nextBucket} under your order. Living that year ~${livingBit}; ${grossUp}.`,
      yearOffset,
      age: markAge,
      calendarYear: calYear,
    });
  }

  const initialLiquidTaxable = accounts
    .filter(
      (a) =>
        a.kind === "taxable" && isAccountLiquid(a, calendarStartYear),
    )
    .reduce((s, a) => s + a.balance, 0);
  const liquidTaxableDepleted = firstBucketDepletionYear(
    rows,
    initialLiquidTaxable,
    (r) => r.liquidTaxable,
    (r) => r.retirement >= DEPLETED_BALANCE || r.shortfall > DEPLETED_BALANCE,
  );

  // Bridge pinch: liquid taxable runs out before penalty-free pretax (59½).
  if (
    hasPretax &&
    liquidTaxableDepleted &&
    liquidTaxableDepleted.age < penaltyFreeMarkAge &&
    age < PENALTY_FREE_AGE
  ) {
    const yearOffset = clampYearOffset(liquidTaxableDepleted.year, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const markAge = age + yearOffset;
    const unlockOffset = clampYearOffset(
      penaltyFreeMarkAge - age,
      age,
      endAge,
    );
    const span = Math.max(1, unlockOffset - yearOffset + 1);
    const shortBit =
      liquidTaxableDepleted.shortfall > DEPLETED_BALANCE
        ? ` Shortfall that year ~${moneyToday(liquidTaxableDepleted.shortfall, inflation, yearOffset)}.`
        : "";
    out.push({
      id: "pinch-bridge-59-5",
      kind: "pinch",
      label: "Taxable bridge pinch",
      detail:
        `Liquid taxable depletes at age ${markAge} (${calYear}) — before pretax unlock at 59½. ` +
        `Ask: is there enough liquid taxable to bridge until Trad/401(k) can be withdrawn without the 10% penalty?` +
        shortBit +
        ` — not tax advice.`,
      yearOffset,
      age: markAge,
      calendarYear: calYear,
      durationYears: span,
    });
  }

  // Custom unlock pinch: liquid taxable depletes before a locked account unlocks.
  const lockedUnlocks = [
    ...new Set(
      accounts
        .filter(
          (a) =>
            a.liquidFromYear != null &&
            a.balance > DEPLETED_BALANCE &&
            a.liquidFromYear > calendarStartYear,
        )
        .map((a) => a.liquidFromYear as number),
    ),
  ].sort((a, b) => a - b);
  if (liquidTaxableDepleted && lockedUnlocks.length > 0) {
    const depleteCal = calendarStartYear + liquidTaxableDepleted.year;
    const nextUnlock = lockedUnlocks.find((y) => y > depleteCal);
    if (nextUnlock != null) {
      const yearOffset = clampYearOffset(liquidTaxableDepleted.year, age, endAge);
      const unlockOffset = clampYearOffset(
        nextUnlock - calendarStartYear,
        age,
        endAge,
      );
      if (unlockOffset > yearOffset) {
        const markAge = age + yearOffset;
        const span = Math.max(1, unlockOffset - yearOffset + 1);
        const labels = accounts
          .filter((a) => a.liquidFromYear === nextUnlock)
          .map((a) => a.label || KIND_LABEL[a.kind])
          .slice(0, 2)
          .join(", ");
        out.push({
          id: `pinch-unlock-${nextUnlock}`,
          kind: "pinch",
          label: "Liquidity unlock pinch",
          detail:
            `Liquid taxable depletes at age ${markAge} (${calendarStartYear + yearOffset}) — ` +
            `before ${labels || "locked accounts"} unlock in ${nextUnlock}. ` +
            `Spend can't tap those balances until then; shortfalls show if liquid accounts aren't enough.`,
          yearOffset,
          age: markAge,
          calendarYear: calendarStartYear + yearOffset,
          durationYears: span,
        });
      }
    }
  }

  const firstShortfall = rows.find((r) => r.shortfall > DEPLETED_BALANCE);
  if (firstShortfall) {
    const yearOffset = clampYearOffset(firstShortfall.year, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const markAge = age + yearOffset;
    const gap = moneyToday(firstShortfall.shortfall, inflation, yearOffset);
    const lockedBit = accounts.some(
      (a) =>
        a.liquidFromYear != null &&
        calendarStartYear + firstShortfall.year < a.liquidFromYear &&
        a.balance > 0,
    )
      ? ` Illiquid balances are skipped until their unlock year.`
      : "";
    out.push({
      id: "pinch-shortfall",
      kind: "pinch",
      label: "Cash-flow shortfall",
      detail:
        `First unmet spend at age ${markAge} (${calYear}) · ~${gap} today's $. ` +
        `Liquid accounts in draw order couldn't cover living/events that year.${lockedBit}`,
      yearOffset,
      age: markAge,
      calendarYear: calYear,
    });
  }

  const initialEducation = accounts
    .filter((a) => a.kind === "529")
    .reduce((s, a) => s + a.balance, 0);
  const educationDepleted = firstBucketDepletionYear(
    rows,
    initialEducation,
    (r) => r.education,
    (r) => r.taxable + r.retirement >= DEPLETED_BALANCE,
  );
  if (educationDepleted) {
    const yearOffset = clampYearOffset(educationDepleted.year, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const markAge = age + yearOffset;
    const nestBit = moneyToday(
      educationDepleted.taxable + educationDepleted.retirement,
      inflation,
      yearOffset,
    );
    out.push({
      id: "bucket-529",
      kind: "bucket",
      label: "529 depleted",
      detail:
        `529 hits $0 at age ${markAge} (${calYear}) — further college costs (if any) ` +
        `come from taxable/retirement. Other accounts then ~${nestBit} today's $.`,
      yearOffset,
      age: markAge,
      calendarYear: calYear,
    });
  }

  const initialRoth = accounts
    .filter((a) => a.kind === "roth")
    .reduce((s, a) => s + a.balance, 0);
  const rothDepleted = firstBucketDepletionYear(
    rows,
    initialRoth,
    (r) => r.roth,
    (r) => r.taxable + (r.retirement - r.roth) + r.education >= DEPLETED_BALANCE,
  );
  if (rothDepleted) {
    const yearOffset = clampYearOffset(rothDepleted.year, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const markAge = age + yearOffset;
    const remaining =
      rothDepleted.taxable +
      (rothDepleted.retirement - rothDepleted.roth) +
      rothDepleted.education;
    const remBit = moneyToday(remaining, inflation, yearOffset);
    out.push({
      id: "bucket-roth",
      kind: "bucket",
      label: "Roth depleted",
      detail:
        `Roth hits $0 at age ${markAge} (${calYear}) — further draws from taxable and/or ` +
        `Trad/401(k) (${orderLabel}). Remaining ~${remBit} today's $.`,
      yearOffset,
      age: markAge,
      calendarYear: calYear,
    });
  }

  const depleted = rows.find(
    (r) => r.total < DEPLETED_BALANCE && r.year > 0,
  );
  if (depleted) {
    const yearOffset = clampYearOffset(depleted.year, age, endAge);
    const calYear = calendarStartYear + yearOffset;
    const markAge = age + yearOffset;
    const livingBit = moneyToday(depleted.living, inflation, yearOffset);
    out.push({
      id: "depletion",
      kind: "depletion",
      label: "Funds run out",
      detail:
        `Portfolio hits $0 at age ${markAge} (${calYear}) — this plan can't fund living ` +
        `(~${livingBit}) past here.`,
      yearOffset,
      age: markAge,
      calendarYear: calYear,
    });
  }

  for (const m of personalMilestones) {
    const yearOffset = clampYearOffset(m.yearOffset, age, endAge);
    out.push({
      id: `personal-${m.id}`,
      kind: "personal",
      label: m.label || "Milestone",
      detail: `Age ${age + yearOffset} · ${calendarStartYear + yearOffset}`,
      yearOffset,
      age: age + yearOffset,
      calendarYear: calendarStartYear + yearOffset,
      sourceId: m.id,
    });
  }

  return out
    .filter((m) => m.yearOffset >= 0 && m.yearOffset <= horizon)
    .sort((a, b) => a.yearOffset - b.yearOffset || a.label.localeCompare(b.label));
}

/** True when the account may be drawn for living spend in this calendar year. */
export function isAccountLiquid(
  acct: Pick<Account, "liquidFromYear">,
  calendarYear: number,
): boolean {
  if (acct.liquidFromYear == null) return true;
  return calendarYear >= acct.liquidFromYear;
}

function isSpendable(
  acct: Account,
  yearOffset: number,
  events: LifeEvent[],
  calendarStartYear: number,
): boolean {
  if (!isAccountLiquid(acct, calendarStartYear + yearOffset)) return false;
  if (acct.kind !== "529") return true;
  if (!acct.linkedEventId) return true;
  const ev = events.find((e) => e.id === acct.linkedEventId);
  if (!ev || !isCollegeEvent(ev)) return true;
  // Earmarked until the linked education event ends; leftover can then fund living.
  return yearOffset >= ev.startYear + ev.durationYears;
}

function cloneAccounts(accounts: Account[]): Account[] {
  return accounts.map((a) => ({ ...a }));
}

function withdrawFromAccounts(
  accounts: Account[],
  need: number,
  order: WithdrawOrder,
  pretaxRate: number,
  cgRate: number,
  modelTaxes: boolean,
  yearOffset: number,
  age: number,
  events: LifeEvent[],
  basisById: Map<string, number>,
  calendarStartYear: number,
): {
  accounts: Account[];
  withdrawn: number;
  withdrawnTaxable: number;
  withdrawnPretax: number;
  withdrawnRoth: number;
  taxes: number;
  shortfall: number;
} {
  let remaining = need;
  let withdrawn = 0;
  let withdrawnTaxable = 0;
  let withdrawnPretax = 0;
  let withdrawnRoth = 0;
  let taxes = 0;
  const next = cloneAccounts(accounts);

  const empty = () => ({
    accounts: next,
    withdrawn: 0,
    withdrawnTaxable: 0,
    withdrawnPretax: 0,
    withdrawnRoth: 0,
    taxes: 0,
    shortfall: Math.max(0, remaining),
  });

  const result = () => ({
    accounts: next,
    withdrawn,
    withdrawnTaxable,
    withdrawnPretax,
    withdrawnRoth,
    taxes,
    shortfall: Math.max(0, remaining),
  });

  const rank = (kind: AccountKind): number => {
    if (order === "pro-rata") return 0;
    if (order === "taxable-trad-roth") {
      if (kind === "taxable") return 0;
      if (isPreTax(kind)) return 1;
      if (kind === "roth") return 2;
      return 3;
    }
    if (kind === "taxable") return 0;
    if (kind === "roth") return 1;
    if (isPreTax(kind)) return 2;
    return 3;
  };

  /** Effective tax rate on each dollar withdrawn from this account (0 = no gross-up). */
  const withdrawTaxRate = (acct: Account): number => {
    if (!modelTaxes) return 0;
    if (isPreTax(acct.kind)) {
      let rate = pretaxRate > 0 && pretaxRate < 1 ? pretaxRate : 0;
      if (age < PENALTY_FREE_AGE) {
        rate = Math.min(0.99, rate + EARLY_WITHDRAWAL_PENALTY);
      }
      return rate > 0 && rate < 1 ? rate : 0;
    }
    if (acct.kind === "taxable" && cgRate > 0) {
      const g = gainFracForAccount(acct, basisById);
      const eff = effectiveTaxableWithdrawRate(g, cgRate);
      return eff > 0 && eff < 1 ? eff : 0;
    }
    return 0;
  };

  const take = (acct: Account, amount: number) => {
    const before = acct.balance;
    const got = Math.min(before, Math.max(0, amount));
    if (got > 0 && acct.kind === "taxable" && before > 0) {
      const basis = Math.max(0, basisById.get(acct.id) ?? 0);
      const basisTaken = (Math.min(basis, before) / before) * got;
      basisById.set(acct.id, Math.max(0, basis - basisTaken));
    }
    acct.balance -= got;
    withdrawn += got;
    if (acct.kind === "taxable") withdrawnTaxable += got;
    else if (isPreTax(acct.kind)) withdrawnPretax += got;
    else if (acct.kind === "roth") withdrawnRoth += got;
    return got;
  };

  const eligible = next.filter(
    (a) => isSpendable(a, yearOffset, events, calendarStartYear) && a.balance > 0,
  );

  if (order === "pro-rata") {
    const total = eligible.reduce((s, a) => s + a.balance, 0);
    if (total <= 0 || remaining <= 0) {
      return empty();
    }
    for (const acct of eligible) {
      if (remaining <= 0) break;
      const share = (acct.balance / total) * need;
      const rate = withdrawTaxRate(acct);
      let gross = share;
      if (rate > 0) {
        gross = share / (1 - rate);
      }
      const got = take(acct, gross);
      if (rate > 0) {
        const net = got * (1 - rate);
        taxes += got - net;
        remaining -= net;
      } else {
        remaining -= got;
      }
    }
    return result();
  }

  const sorted = [...eligible].sort((a, b) => rank(a.kind) - rank(b.kind));
  for (const acct of sorted) {
    if (remaining <= 0.5) break;
    const rate = withdrawTaxRate(acct);
    let grossNeeded = remaining;
    if (rate > 0) {
      grossNeeded = remaining / (1 - rate);
    }
    const got = take(acct, grossNeeded);
    if (rate > 0) {
      const net = got * (1 - rate);
      taxes += got - net;
      remaining -= net;
    } else {
      remaining -= got;
    }
  }

  return result();
}

/**
 * Take the year's RMD from pretax accounts (pro-rata), apply net proceeds toward
 * spend need first, and move any leftover net into taxable brokerage.
 * Returns spend-funding gross in `withdrawnForSpend` (excludes excess rolled over).
 */
function applyRequiredMinimumDistribution(
  accounts: Account[],
  age: number,
  spendNeed: number,
  taxRate: number,
  modelTaxes: boolean,
  defaultFund: FundPreset,
  basisById: Map<string, number>,
): {
  accounts: Account[];
  remainingNeed: number;
  rmdGross: number;
  withdrawnForSpend: number;
  taxes: number;
} {
  const next = cloneAccounts(accounts);
  const pretax = next.filter((a) => isPreTax(a.kind) && a.balance > 0);
  const pretaxTotal = pretax.reduce((s, a) => s + a.balance, 0);
  const rmdTarget = Math.min(computeRmd(pretaxTotal, age), pretaxTotal);
  if (rmdTarget <= 0 || pretax.length === 0) {
    return {
      accounts: next,
      remainingNeed: spendNeed,
      rmdGross: 0,
      withdrawnForSpend: 0,
      taxes: 0,
    };
  }

  let taken = 0;
  for (const acct of pretax) {
    const share = (acct.balance / pretaxTotal) * rmdTarget;
    const got = Math.min(acct.balance, share);
    acct.balance -= got;
    taken += got;
  }
  // Absorb rounding remainder from the largest remaining pretax balance.
  if (taken + 0.01 < rmdTarget) {
    const short = rmdTarget - taken;
    const donor = [...pretax].sort((a, b) => b.balance - a.balance)[0];
    if (donor && donor.balance > 0) {
      const got = Math.min(donor.balance, short);
      donor.balance -= got;
      taken += got;
    }
  }

  const taxed =
    modelTaxes && taxRate > 0 && taxRate < 1;
  const net = taxed ? taken * (1 - taxRate) : taken;
  const appliedToNeed = Math.min(Math.max(0, spendNeed), net);
  const excessNet = net - appliedToNeed;
  const remainingNeed = Math.max(0, spendNeed - appliedToNeed);

  const grossForSpend = taxed
    ? appliedToNeed / (1 - taxRate)
    : appliedToNeed;
  const withdrawnForSpend = Math.min(taken, Math.max(0, grossForSpend));
  const taxes = taxed ? withdrawnForSpend * taxRate : 0;

  if (excessNet > 0.5) {
    let taxableAcct = next.find((a) => a.kind === "taxable");
    if (!taxableAcct) {
      const fund = defaultFund === "custom" ? "moderate" : defaultFund;
      taxableAcct = {
        id: "taxable-rmd",
        kind: "taxable",
        label: "Brokerage",
        balance: 0,
        fund,
        customReturn: fundRate(fund, FUND_PRESETS.moderate.rate),
        linkedEventId: null,
        liquidFromYear: null,
      };
      next.push(taxableAcct);
      // After-tax RMD excess → full cost basis.
      basisById.set(taxableAcct.id, 0);
    }
    taxableAcct.balance += excessNet;
    basisById.set(
      taxableAcct.id,
      (basisById.get(taxableAcct.id) ?? 0) + excessNet,
    );
  }

  return {
    accounts: next,
    remainingNeed,
    rmdGross: taken,
    withdrawnForSpend,
    taxes,
  };
}

function payEventFrom529(
  accounts: Account[],
  eventId: string,
  cost: number,
): { accounts: Account[]; paid: number } {
  const next = cloneAccounts(accounts);
  let remaining = cost;
  let paid = 0;
  for (const acct of next) {
    if (remaining <= 0) break;
    if (acct.kind !== "529" || acct.linkedEventId !== eventId) continue;
    const got = Math.min(acct.balance, remaining);
    acct.balance -= got;
    remaining -= got;
    paid += got;
  }
  return { accounts: next, paid };
}

export function project(
  params: ScenarioInput,
  calendarStartYear: number = new Date().getFullYear(),
): YearRow[] {
  const horizon = Math.max(1, params.endAge - params.age);
  let accounts = cloneAccounts(params.accounts);
  const basisById = initTaxableBasis(
    accounts,
    params.taxableCostBasisPct ?? DEFAULT_SCENARIO.taxableCostBasisPct,
  );
  const rows: YearRow[] = [];
  const investableStart = accounts
    .filter((a) => a.kind !== "529")
    .reduce((s, a) => s + a.balance, 0);
  // Living + event costs are entered in today's $; multiply by inflate each year.
  const baseLiving =
    params.spendMode === "percent"
      ? investableStart * params.withdrawPct
      : params.annualSpend;

  const pretaxRate = effectivePretaxRate(params);
  const cgRate = effectiveCapitalGainsRate(params);

  for (let y = 0; y <= horizon; y++) {
    const age = params.age + y;
    const inflate = Math.pow(1 + params.inflation, y);
    const living = baseLiving * inflate;

    let eventCost = 0;
    let eventFrom529 = 0;
    let collegeCost = 0;
    for (const ev of params.events) {
      if (y < ev.startYear || y >= ev.startYear + ev.durationYears) continue;
      const cost = ev.annualCost * inflate;
      eventCost += cost;
      if (isCollegeEvent(ev)) {
        collegeCost += cost;
        const paid = payEventFrom529(accounts, ev.id, cost);
        accounts = paid.accounts;
        eventFrom529 += paid.paid;
      }
    }

    const income = (params.incomes ?? [])
      .filter((inc) => age >= inc.startAge && (inc.endAge == null || age <= inc.endAge))
      .reduce(
        (s, inc) => s + inc.annualAmount * (inc.inflates ? inflate : 1),
        0,
      );

    const eventNet = Math.max(0, eventCost - eventFrom529);
    let need = Math.max(0, living + eventNet - income);

    let withdrawn = 0;
    let withdrawnTaxable = 0;
    let withdrawnPretax = 0;
    let withdrawnRoth = 0;
    let rmd = 0;
    let taxes = 0;
    let shortfall = 0;

    if (age >= RMD_DEFAULT_AGE) {
      const rmdResult = applyRequiredMinimumDistribution(
        accounts,
        age,
        need,
        pretaxRate,
        params.modelTaxes,
        params.defaultFund,
        basisById,
      );
      accounts = rmdResult.accounts;
      need = rmdResult.remainingNeed;
      rmd = rmdResult.rmdGross;
      withdrawn += rmdResult.withdrawnForSpend;
      withdrawnPretax += rmdResult.rmdGross;
      taxes += rmdResult.taxes;
    }

    const {
      accounts: after,
      withdrawn: spendWithdrawn,
      withdrawnTaxable: spendTaxable,
      withdrawnPretax: spendPretax,
      withdrawnRoth: spendRoth,
      taxes: spendTaxes,
      shortfall: spendShortfall,
    } = withdrawFromAccounts(
      accounts,
      need,
      params.order,
      pretaxRate,
      cgRate,
      params.modelTaxes,
      y,
      age,
      params.events,
      basisById,
      calendarStartYear,
    );
    accounts = after;
    withdrawn += spendWithdrawn;
    withdrawnTaxable += spendTaxable;
    withdrawnPretax += spendPretax;
    withdrawnRoth += spendRoth;
    taxes += spendTaxes;
    shortfall = spendShortfall;

    for (const acct of accounts) {
      // Growth increases market value; cost basis stays put (gain share rises).
      acct.balance *= 1 + fundRate(acct.fund, acct.customReturn);
    }

    const calYear = calendarStartYear + y;
    const taxable = accounts
      .filter((a) => a.kind === "taxable")
      .reduce((s, a) => s + a.balance, 0);
    const liquidTaxable = accounts
      .filter((a) => a.kind === "taxable" && isAccountLiquid(a, calYear))
      .reduce((s, a) => s + a.balance, 0);
    const education = accounts
      .filter((a) => a.kind === "529")
      .reduce((s, a) => s + a.balance, 0);
    const liquidEducation = accounts
      .filter((a) => a.kind === "529" && isAccountLiquid(a, calYear))
      .reduce((s, a) => s + a.balance, 0);
    const roth = accounts
      .filter((a) => a.kind === "roth")
      .reduce((s, a) => s + a.balance, 0);
    const liquidRoth = accounts
      .filter((a) => a.kind === "roth" && isAccountLiquid(a, calYear))
      .reduce((s, a) => s + a.balance, 0);
    const pretax = accounts
      .filter((a) => isPreTax(a.kind))
      .reduce((s, a) => s + a.balance, 0);
    const liquidPretax = accounts
      .filter((a) => isPreTax(a.kind) && isAccountLiquid(a, calYear))
      .reduce((s, a) => s + a.balance, 0);
    const retirement = roth + pretax;

    rows.push({
      year: y,
      age,
      taxable,
      retirement,
      roth,
      education,
      total: taxable + retirement + education,
      withdrawn,
      withdrawnTaxable,
      withdrawnPretax,
      withdrawnRoth,
      rmd,
      eventCost,
      eventFrom529,
      collegeCost,
      living,
      income,
      taxes,
      shortfall,
      liquidTaxable,
      liquidPretax,
      liquidRoth,
      liquidEducation,
    });

    if (taxable + retirement + education < 1 && y > 0) break;
  }

  return rows;
}

/**
 * Convert a then-year (nominal) dollar amount to today's dollars.
 * yearOffset 0 = current year (no deflation).
 */
export function deflateToToday(
  nominal: number,
  inflation: number,
  yearOffset: number,
): number {
  if (!Number.isFinite(nominal)) return nominal;
  if (yearOffset <= 0 || !Number.isFinite(inflation) || inflation === 0) {
    return nominal;
  }
  return nominal / Math.pow(1 + inflation, yearOffset);
}

export function fmtMoney(n: number, compact = false): string {
  if (!Number.isFinite(n)) return "—";
  if (compact) {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newAccount(
  kind: AccountKind,
  defaults: Pick<ScenarioInput, "defaultFund" | "events">,
): Account {
  const fund = defaults.defaultFund;
  const customReturn = fundRate(fund, 0.07);
  if (kind === "529") {
    const college =
      defaults.events.find((e) => isCollegeEvent(e)) ?? defaults.events[0];
    return {
      id: uid("529"),
      kind,
      label: "529 plan",
      balance: 50_000,
      fund: "aggressive",
      customReturn: 0.085,
      linkedEventId: college?.id ?? null,
      liquidFromYear: null,
    };
  }
  return {
    id: uid(kind),
    kind,
    label: KIND_LABEL[kind],
    balance: 100_000,
    fund,
    customReturn,
    linkedEventId: null,
    liquidFromYear: null,
  };
}

export function migrateScenario(raw: unknown): ScenarioInput {
  if (!raw || typeof raw !== "object") return DEFAULT_SCENARIO;
  const data = raw as Partial<ScenarioInput> & {
    returnRate?: number;
    taxRate?: number;
    ssEnabled?: boolean;
    ssAnnual?: number;
    ssStartAge?: number;
    accounts?: Array<Partial<Account> & { balance?: number }>;
  };

  const eventsRaw = data.events?.length
    ? data.events
    : (data as { colleges?: Array<Partial<LifeEvent> & { id?: string }> }).colleges
        ?.length
      ? (data as { colleges: Array<Partial<LifeEvent> & { id?: string }> })
          .colleges
      : DEFAULT_SCENARIO.events;
  const events: LifeEvent[] = eventsRaw.map((ev, i) => {
    const kindRaw = (ev as Partial<LifeEvent>).kind;
    const kind: LifeEventKind =
      kindRaw === "wedding" ||
      kindRaw === "home" ||
      kindRaw === "other" ||
      kindRaw === "college"
        ? kindRaw
        : "college";
    return {
      id: ev.id ?? `event-${i}`,
      kind,
      label: ev.label ?? EVENT_KIND_LABEL[kind],
      startYear: Math.max(0, Math.round(ev.startYear ?? 0)),
      durationYears: Math.max(1, Math.round(ev.durationYears ?? 1)),
      annualCost: Math.max(0, ev.annualCost ?? 0),
    };
  });
  const defaultFund = data.defaultFund ?? "moderate";
  const firstCollege =
    events.find((e) => isCollegeEvent(e)) ?? events[0] ?? null;

  const accounts: Account[] = (data.accounts ?? DEFAULT_SCENARIO.accounts).map((a, i) => {
    const kind = (a.kind as AccountKind) ?? "taxable";
    const rawLiquid = (a as Partial<Account>).liquidFromYear;
    const liquidFromYear =
      typeof rawLiquid === "number" &&
      Number.isFinite(rawLiquid) &&
      rawLiquid > 0
        ? Math.round(rawLiquid)
        : null;
    return {
      id: a.id ?? `acct-${i}`,
      kind,
      label: a.label ?? KIND_LABEL[kind],
      balance: a.balance ?? 0,
      fund: a.fund ?? defaultFund,
      customReturn: a.customReturn ?? fundRate(a.fund ?? defaultFund, 0.07),
      linkedEventId:
        a.linkedEventId ?? (kind === "529" ? firstCollege?.id ?? null : null),
      liquidFromYear,
    };
  });

  let incomes = data.incomes;
  if (!incomes) {
    incomes =
      data.ssEnabled === false
        ? []
        : [
            {
              id: "ss-1",
              label: "Social Security",
              annualAmount: data.ssAnnual ?? 36_000,
              startAge: data.ssStartAge ?? 67,
              endAge: null,
              inflates: true,
            },
          ];
  }

  const age = data.age ?? DEFAULT_SCENARIO.age;
  const endAge = data.endAge ?? DEFAULT_SCENARIO.endAge;
  const horizon = Math.max(0, endAge - age);

  const milestonesRaw = (
    data as Partial<ScenarioInput> & {
      personalMilestones?: Array<Partial<PersonalMilestone>>;
      milestones?: Array<Partial<PersonalMilestone>>;
    }
  ).personalMilestones ??
    (data as { milestones?: Array<Partial<PersonalMilestone>> }).milestones ??
    [];
  const personalMilestones: PersonalMilestone[] = Array.isArray(milestonesRaw)
    ? milestonesRaw
        .filter((m) => m && typeof m === "object")
        .map((m, i) => {
          const yearOffset = Math.max(
            0,
            Math.min(horizon, Math.round(Number(m.yearOffset) || 0)),
          );
          return {
            id: typeof m.id === "string" && m.id ? m.id : `milestone-${i}`,
            label:
              typeof m.label === "string" && m.label.trim()
                ? m.label.trim()
                : "Milestone",
            yearOffset,
          };
        })
    : [];

  // Drop legacy working-years keys so they never re-enter ScenarioInput.
  const legacy = data as Record<string, unknown>;
  const {
    workSalary: _a,
    workRaise: _b,
    workEndAge: _c,
    workIncomes: _d,
    milestones: _e,
    ...safe
  } = legacy;

  return {
    ...DEFAULT_SCENARIO,
    ...(safe as Partial<ScenarioInput>),
    defaultFund,
    accounts,
    incomes: incomes ?? [],
    events,
    personalMilestones,
    stateCode: data.stateCode ?? DEFAULT_SCENARIO.stateCode,
    taxableCostBasisPct: clampCostBasisPct(
      typeof data.taxableCostBasisPct === "number"
        ? data.taxableCostBasisPct
        : DEFAULT_SCENARIO.taxableCostBasisPct,
    ),
    // Always re-estimate; ignore legacy saved federalRate / taxRate pills.
    federalRate: estimateFederalOrdinaryRate({
      age,
      spendMode: data.spendMode ?? DEFAULT_SCENARIO.spendMode,
      annualSpend: data.annualSpend ?? DEFAULT_SCENARIO.annualSpend,
      withdrawPct: data.withdrawPct ?? DEFAULT_SCENARIO.withdrawPct,
      accounts,
      incomes: incomes ?? [],
    }),
  };
}
