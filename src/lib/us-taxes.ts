/**
 * Approximate US state ordinary-income tax treatment for retirement planning.
 * Rates are simplified planning defaults (rough top / effective ordinary rates),
 * not filing advice. Update when laws change.
 */

export type UsStateCode =
  | "AL"
  | "AK"
  | "AZ"
  | "AR"
  | "CA"
  | "CO"
  | "CT"
  | "DE"
  | "DC"
  | "FL"
  | "GA"
  | "HI"
  | "ID"
  | "IL"
  | "IN"
  | "IA"
  | "KS"
  | "KY"
  | "LA"
  | "ME"
  | "MD"
  | "MA"
  | "MI"
  | "MN"
  | "MS"
  | "MO"
  | "MT"
  | "NE"
  | "NV"
  | "NH"
  | "NJ"
  | "NM"
  | "NY"
  | "NC"
  | "ND"
  | "OH"
  | "OK"
  | "OR"
  | "PA"
  | "RI"
  | "SC"
  | "SD"
  | "TN"
  | "TX"
  | "UT"
  | "VT"
  | "VA"
  | "WA"
  | "WV"
  | "WI"
  | "WY";

export type UsStateTax = {
  code: UsStateCode;
  name: string;
  /** Approximate rate applied to Traditional/401(k) withdrawals when taxed. */
  ordinaryRate: number;
  /** If false, state generally does not tax IRA/pension/401(k) distributions. */
  taxesRetirementDistributions: boolean;
  note?: string;
};

export const US_STATES: UsStateTax[] = [
  { code: "AL", name: "Alabama", ordinaryRate: 0.05, taxesRetirementDistributions: true },
  { code: "AK", name: "Alaska", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No state income tax" },
  { code: "AZ", name: "Arizona", ordinaryRate: 0.025, taxesRetirementDistributions: true },
  { code: "AR", name: "Arkansas", ordinaryRate: 0.039, taxesRetirementDistributions: true },
  { code: "CA", name: "California", ordinaryRate: 0.093, taxesRetirementDistributions: true, note: "High brackets; 9.3% is a common planning mid/high rate" },
  { code: "CO", name: "Colorado", ordinaryRate: 0.044, taxesRetirementDistributions: true },
  { code: "CT", name: "Connecticut", ordinaryRate: 0.0699, taxesRetirementDistributions: true },
  { code: "DE", name: "Delaware", ordinaryRate: 0.066, taxesRetirementDistributions: true },
  { code: "DC", name: "District of Columbia", ordinaryRate: 0.085, taxesRetirementDistributions: true },
  { code: "FL", name: "Florida", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No state income tax" },
  { code: "GA", name: "Georgia", ordinaryRate: 0.0539, taxesRetirementDistributions: true },
  { code: "HI", name: "Hawaii", ordinaryRate: 0.11, taxesRetirementDistributions: true },
  { code: "ID", name: "Idaho", ordinaryRate: 0.058, taxesRetirementDistributions: true },
  { code: "IL", name: "Illinois", ordinaryRate: 0.0495, taxesRetirementDistributions: true },
  { code: "IN", name: "Indiana", ordinaryRate: 0.0305, taxesRetirementDistributions: true },
  { code: "IA", name: "Iowa", ordinaryRate: 0.038, taxesRetirementDistributions: true },
  { code: "KS", name: "Kansas", ordinaryRate: 0.057, taxesRetirementDistributions: true },
  { code: "KY", name: "Kentucky", ordinaryRate: 0.04, taxesRetirementDistributions: true },
  { code: "LA", name: "Louisiana", ordinaryRate: 0.0425, taxesRetirementDistributions: true },
  { code: "ME", name: "Maine", ordinaryRate: 0.0715, taxesRetirementDistributions: true },
  { code: "MD", name: "Maryland", ordinaryRate: 0.0575, taxesRetirementDistributions: true },
  { code: "MA", name: "Massachusetts", ordinaryRate: 0.05, taxesRetirementDistributions: true },
  { code: "MI", name: "Michigan", ordinaryRate: 0.0425, taxesRetirementDistributions: true },
  { code: "MN", name: "Minnesota", ordinaryRate: 0.0985, taxesRetirementDistributions: true },
  { code: "MS", name: "Mississippi", ordinaryRate: 0.047, taxesRetirementDistributions: true },
  { code: "MO", name: "Missouri", ordinaryRate: 0.048, taxesRetirementDistributions: true },
  { code: "MT", name: "Montana", ordinaryRate: 0.059, taxesRetirementDistributions: true },
  { code: "NE", name: "Nebraska", ordinaryRate: 0.0584, taxesRetirementDistributions: true },
  { code: "NV", name: "Nevada", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No state income tax" },
  { code: "NH", name: "New Hampshire", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No wage/retirement income tax" },
  { code: "NJ", name: "New Jersey", ordinaryRate: 0.0637, taxesRetirementDistributions: true },
  { code: "NM", name: "New Mexico", ordinaryRate: 0.059, taxesRetirementDistributions: true },
  { code: "NY", name: "New York", ordinaryRate: 0.0685, taxesRetirementDistributions: true, note: "NYC local tax not included" },
  { code: "NC", name: "North Carolina", ordinaryRate: 0.0425, taxesRetirementDistributions: true },
  { code: "ND", name: "North Dakota", ordinaryRate: 0.025, taxesRetirementDistributions: true },
  { code: "OH", name: "Ohio", ordinaryRate: 0.035, taxesRetirementDistributions: true },
  { code: "OK", name: "Oklahoma", ordinaryRate: 0.0475, taxesRetirementDistributions: true },
  { code: "OR", name: "Oregon", ordinaryRate: 0.099, taxesRetirementDistributions: true },
  { code: "PA", name: "Pennsylvania", ordinaryRate: 0.0307, taxesRetirementDistributions: true },
  { code: "RI", name: "Rhode Island", ordinaryRate: 0.0599, taxesRetirementDistributions: true },
  { code: "SC", name: "South Carolina", ordinaryRate: 0.064, taxesRetirementDistributions: true },
  { code: "SD", name: "South Dakota", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No state income tax" },
  { code: "TN", name: "Tennessee", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No state income tax" },
  { code: "TX", name: "Texas", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No state income tax" },
  { code: "UT", name: "Utah", ordinaryRate: 0.0465, taxesRetirementDistributions: true },
  { code: "VT", name: "Vermont", ordinaryRate: 0.0875, taxesRetirementDistributions: true },
  { code: "VA", name: "Virginia", ordinaryRate: 0.0575, taxesRetirementDistributions: true },
  {
    code: "WA",
    name: "Washington",
    ordinaryRate: 0,
    taxesRetirementDistributions: false,
    note: "No state income tax on wages/retirement; 7% long-term capital gains excise modeled on taxable brokerage gains (standard deduction / $1M tier not modeled)",
  },
  { code: "WV", name: "West Virginia", ordinaryRate: 0.0512, taxesRetirementDistributions: true },
  { code: "WI", name: "Wisconsin", ordinaryRate: 0.0765, taxesRetirementDistributions: true },
  { code: "WY", name: "Wyoming", ordinaryRate: 0, taxesRetirementDistributions: false, note: "No state income tax" },
];

export function getUsState(code: string | null | undefined): UsStateTax {
  return US_STATES.find((s) => s.code === code) ?? US_STATES.find((s) => s.code === "FL")!;
}

/**
 * Combined marginal-ish rate for grossing up pre-tax withdrawals.
 * Uses federal + applicable state ordinary rate (additive, capped).
 * State rate is 0 when the state does not tax retirement distributions.
 */
export function combinedPretaxRate(
  federalRate: number,
  stateCode: UsStateCode,
): { federal: number; state: number; combined: number; stateInfo: UsStateTax } {
  const stateInfo = getUsState(stateCode);
  const federal = Math.max(0, Math.min(0.5, federalRate));
  const state =
    stateInfo.taxesRetirementDistributions && stateInfo.ordinaryRate > 0
      ? stateInfo.ordinaryRate
      : 0;
  const combined = Math.min(0.6, federal + state);
  return { federal, state, combined, stateInfo };
}

/** Kept for older UI/docs references; rates are no longer picked manually. */
export const FEDERAL_RATE_PRESETS = [
  { label: "12%", value: 0.12 },
  { label: "22%", value: 0.22 },
  { label: "24%", value: 0.24 },
  { label: "32%", value: 0.32 },
  { label: "35%", value: 0.35 },
] as const;

/**
 * Filing status for the federal ordinary-rate estimate.
 * Default is single (more conservative bracket thresholds). Documented in Help.
 */
export type FederalFilingStatus = "single" | "mfj";

export const FEDERAL_FILING_STATUS_DEFAULT: FederalFilingStatus = "single";

/** Approximate 2025 IRS ordinary brackets (taxable income upper bounds). */
export const FEDERAL_ORDINARY_BRACKETS_2025: Record<
  FederalFilingStatus,
  ReadonlyArray<{ upTo: number; rate: number }>
> = {
  single: [
    { upTo: 11_925, rate: 0.1 },
    { upTo: 48_475, rate: 0.12 },
    { upTo: 103_350, rate: 0.22 },
    { upTo: 197_300, rate: 0.24 },
    { upTo: 250_525, rate: 0.32 },
    { upTo: 626_350, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
  mfj: [
    { upTo: 23_850, rate: 0.1 },
    { upTo: 96_950, rate: 0.12 },
    { upTo: 206_700, rate: 0.22 },
    { upTo: 394_600, rate: 0.24 },
    { upTo: 501_050, rate: 0.32 },
    { upTo: 751_600, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
};

export const FEDERAL_STANDARD_DEDUCTION_2025: Record<FederalFilingStatus, number> = {
  single: 15_000,
  mfj: 30_000,
};

export type FederalRateEstimateInput = {
  age: number;
  spendMode: "fixed" | "percent";
  annualSpend: number;
  withdrawPct: number;
  accounts: ReadonlyArray<{ kind: string; balance: number }>;
  incomes: ReadonlyArray<{
    annualAmount: number;
    startAge: number;
    endAge: number | null;
  }>;
  filingStatus?: FederalFilingStatus;
};

export function marginalFederalOrdinaryRate(
  taxableIncome: number,
  filingStatus: FederalFilingStatus = FEDERAL_FILING_STATUS_DEFAULT,
): number {
  const income = Math.max(0, taxableIncome);
  const brackets = FEDERAL_ORDINARY_BRACKETS_2025[filingStatus];
  for (const b of brackets) {
    if (income <= b.upTo) return b.rate;
  }
  return brackets[brackets.length - 1]!.rate;
}

/**
 * Infer a federal ordinary marginal rate for pretax gross-up from the scenario.
 *
 * Heuristic (single filer by default, 2025 brackets + standard deduction):
 * - Lifestyle = fixed annual spend, or % of non-529 balances.
 * - Income = streams active at current age (SS/pension treated as ordinary for planning).
 * - If any Traditional/401(k) exists, treat the portfolio gap (lifestyle − income) as
 *   ordinary income too — that is what gross-up is for.
 * - Taxable income ≈ max(0, ordinary − standard deduction); return that bracket's rate.
 *
 * Not tax advice — a planning default so users need not pick a bracket pill.
 */
export function estimateFederalOrdinaryRate(input: FederalRateEstimateInput): number {
  const filing = input.filingStatus ?? FEDERAL_FILING_STATUS_DEFAULT;
  const investable = input.accounts
    .filter((a) => a.kind !== "529")
    .reduce((s, a) => s + Math.max(0, a.balance), 0);
  const lifestyle =
    input.spendMode === "percent"
      ? investable * Math.max(0, input.withdrawPct)
      : Math.max(0, input.annualSpend);

  const income = input.incomes
    .filter(
      (inc) =>
        input.age >= inc.startAge && (inc.endAge == null || input.age <= inc.endAge),
    )
    .reduce((s, inc) => s + Math.max(0, inc.annualAmount), 0);

  const hasPretax = input.accounts.some(
    (a) => a.kind === "traditional" || a.kind === "401k",
  );
  // When pretax balances exist, max(lifestyle, income) is a simple ordinary proxy
  // (portfolio gap + income that funds spending). Without pretax, only income streams
  // look like ordinary income for gross-up.
  const ordinaryProxy = hasPretax ? Math.max(lifestyle, income) : income;
  const taxableIncome = Math.max(
    0,
    ordinaryProxy - FEDERAL_STANDARD_DEDUCTION_2025[filing],
  );
  return marginalFederalOrdinaryRate(taxableIncome, filing);
}

/**
 * Approximate 2025 federal long-term capital gains preferential brackets
 * (taxable-income thresholds for the 0% / 15% / 20% rates).
 */
export const FEDERAL_LTCG_BRACKETS_2025: Record<
  FederalFilingStatus,
  ReadonlyArray<{ upTo: number; rate: number }>
> = {
  single: [
    { upTo: 48_350, rate: 0 },
    { upTo: 533_400, rate: 0.15 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.2 },
  ],
  mfj: [
    { upTo: 96_700, rate: 0 },
    { upTo: 600_050, rate: 0.15 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.2 },
  ],
};

export function marginalFederalLtcgRate(
  taxableIncome: number,
  filingStatus: FederalFilingStatus = FEDERAL_FILING_STATUS_DEFAULT,
): number {
  const income = Math.max(0, taxableIncome);
  const brackets = FEDERAL_LTCG_BRACKETS_2025[filingStatus];
  for (const b of brackets) {
    if (income <= b.upTo) return b.rate;
  }
  return brackets[brackets.length - 1]!.rate;
}

/**
 * Infer a federal LTCG preferential rate for taxable-brokerage gross-up.
 * Uses the same ordinary-income proxy as {@link estimateFederalOrdinaryRate}
 * (lifestyle / income after standard deduction) — a planning default, not
 * NIIT or stacking advice.
 */
export function estimateFederalLtcgRate(input: FederalRateEstimateInput): number {
  const filing = input.filingStatus ?? FEDERAL_FILING_STATUS_DEFAULT;
  const investable = input.accounts
    .filter((a) => a.kind !== "529")
    .reduce((s, a) => s + Math.max(0, a.balance), 0);
  const lifestyle =
    input.spendMode === "percent"
      ? investable * Math.max(0, input.withdrawPct)
      : Math.max(0, input.annualSpend);

  const income = input.incomes
    .filter(
      (inc) =>
        input.age >= inc.startAge && (inc.endAge == null || input.age <= inc.endAge),
    )
    .reduce((s, inc) => s + Math.max(0, inc.annualAmount), 0);

  const hasTaxableBrokerage = input.accounts.some(
    (a) => a.kind === "taxable" && a.balance > 0,
  );
  // When taxable brokerage exists, lifestyle (or income) proxies the bracket
  // that CG sits on top of. Without taxable balances, only streams matter.
  const ordinaryProxy = hasTaxableBrokerage ? Math.max(lifestyle, income) : income;
  const taxableIncome = Math.max(
    0,
    ordinaryProxy - FEDERAL_STANDARD_DEDUCTION_2025[filing],
  );
  return marginalFederalLtcgRate(taxableIncome, filing);
}

/**
 * Approximate state tax rate on long-term capital gains from taxable brokerage.
 * WA: 7% CG excise (simplified). No-income-tax states: 0. Other states: ordinary
 * rate (most tax LTCG as ordinary income).
 */
export function stateCapitalGainsRate(stateCode: UsStateCode): number {
  const stateInfo = getUsState(stateCode);
  if (stateInfo.code === "WA") return 0.07;
  if (stateInfo.ordinaryRate <= 0) return 0;
  return stateInfo.ordinaryRate;
}

/**
 * Combined rate applied to the *gain portion* of a taxable brokerage withdrawal.
 */
export function combinedCapitalGainsRate(
  federalLtcgRate: number,
  stateCode: UsStateCode,
): { federal: number; state: number; combined: number } {
  const federal = Math.max(0, Math.min(0.37, federalLtcgRate));
  const state = Math.max(0, Math.min(0.15, stateCapitalGainsRate(stateCode)));
  return { federal, state, combined: Math.min(0.55, federal + state) };
}

/**
 * Effective tax rate on each dollar withdrawn from taxable brokerage when
 * `gainFrac` of the dollar is unrealized gain (0…1).
 * net = gross × (1 − effectiveTaxableWithdrawRate(...))
 */
export function effectiveTaxableWithdrawRate(
  gainFrac: number,
  combinedCgRate: number,
): number {
  const g = Math.max(0, Math.min(1, gainFrac));
  const r = Math.max(0, Math.min(0.55, combinedCgRate));
  return Math.min(0.55, g * r);
}
