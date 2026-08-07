import { describe, expect, test } from "bun:test";
import {
  combinedCapitalGainsRate,
  combinedPretaxRate,
  effectiveTaxableWithdrawRate,
  estimateFederalLtcgRate,
  estimateFederalOrdinaryRate,
  getUsState,
  marginalFederalLtcgRate,
  marginalFederalOrdinaryRate,
  stateCapitalGainsRate,
} from "./us-taxes";

describe("us-taxes", () => {
  test("getUsState falls back to FL for unknown codes", () => {
    expect(getUsState("ZZ").code).toBe("FL");
    expect(getUsState(null).code).toBe("FL");
  });

  test("combinedPretaxRate adds state when retirement distributions are taxed", () => {
    const ca = combinedPretaxRate(0.22, "CA");
    expect(ca.federal).toBe(0.22);
    expect(ca.state).toBeGreaterThan(0);
    expect(ca.combined).toBeCloseTo(0.22 + ca.state, 6);
  });

  test("combinedPretaxRate zeros state for no-tax states like FL", () => {
    const fl = combinedPretaxRate(0.22, "FL");
    expect(fl.state).toBe(0);
    expect(fl.combined).toBe(0.22);
  });

  test("marginalFederalOrdinaryRate uses 2025 single brackets", () => {
    expect(marginalFederalOrdinaryRate(10_000, "single")).toBe(0.1);
    expect(marginalFederalOrdinaryRate(40_000, "single")).toBe(0.12);
    expect(marginalFederalOrdinaryRate(80_000, "single")).toBe(0.22);
  });

  test("estimateFederalOrdinaryRate treats lifestyle gap as ordinary when pretax exists", () => {
    const withPretax = estimateFederalOrdinaryRate({
      age: 65,
      spendMode: "fixed",
      annualSpend: 120_000,
      withdrawPct: 0.04,
      accounts: [{ kind: "traditional", balance: 500_000 }],
      incomes: [],
    });
    expect(withPretax).toBe(0.24);

    const noPretax = estimateFederalOrdinaryRate({
      age: 65,
      spendMode: "fixed",
      annualSpend: 120_000,
      withdrawPct: 0.04,
      accounts: [{ kind: "roth", balance: 500_000 }],
      incomes: [],
    });
    expect(noPretax).toBe(0.1);
  });

  test("estimateFederalOrdinaryRate includes active income streams", () => {
    const rate = estimateFederalOrdinaryRate({
      age: 70,
      spendMode: "fixed",
      annualSpend: 40_000,
      withdrawPct: 0.04,
      accounts: [{ kind: "roth", balance: 100_000 }],
      incomes: [
        {
          annualAmount: 50_000,
          startAge: 67,
          endAge: null,
        },
      ],
    });
    expect(rate).toBe(0.12);
  });

  test("marginalFederalLtcgRate uses 2025 preferential brackets", () => {
    expect(marginalFederalLtcgRate(40_000, "single")).toBe(0);
    expect(marginalFederalLtcgRate(100_000, "single")).toBe(0.15);
    expect(marginalFederalLtcgRate(600_000, "single")).toBe(0.2);
  });

  test("estimateFederalLtcgRate uses lifestyle when taxable brokerage exists", () => {
    const rate = estimateFederalLtcgRate({
      age: 65,
      spendMode: "fixed",
      annualSpend: 90_000,
      withdrawPct: 0.04,
      accounts: [{ kind: "taxable", balance: 400_000 }],
      incomes: [],
    });
    expect(rate).toBe(0.15);
  });

  test("stateCapitalGainsRate models WA at 7% and FL at 0", () => {
    expect(stateCapitalGainsRate("WA")).toBe(0.07);
    expect(stateCapitalGainsRate("FL")).toBe(0);
    expect(stateCapitalGainsRate("CA")).toBeGreaterThan(0);
    expect(getUsState("WA").note).toMatch(/capital gains/i);
  });

  test("combinedCapitalGainsRate and effectiveTaxableWithdrawRate", () => {
    const fl = combinedCapitalGainsRate(0.15, "FL");
    expect(fl.combined).toBe(0.15);
    expect(effectiveTaxableWithdrawRate(0.5, 0.15)).toBeCloseTo(0.075, 6);

    const wa = combinedCapitalGainsRate(0.15, "WA");
    expect(wa.state).toBe(0.07);
    expect(wa.combined).toBeCloseTo(0.22, 6);
  });
});
