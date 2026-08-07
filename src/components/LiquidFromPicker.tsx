"use client";

import { YearSliderPicker } from "@/components/YearSliderPicker";

/**
 * Compact row trigger: opens a fixed popover with a year slider for
 * Account.liquidFromYear (null = liquid now).
 */
export function LiquidFromPicker({
  value,
  startYear,
  horizon,
  onChange,
  accountLabel,
  voicePath,
}: {
  value: number | null;
  /** Current calendar / projection start year. */
  startYear: number;
  /** Years from start through end of projection (endAge − age). */
  horizon: number;
  onChange: (year: number | null) => void;
  accountLabel?: string;
  voicePath?: string;
}) {
  const maxYear = Math.max(
    startYear + Math.max(1, horizon),
    value != null && Number.isFinite(value) ? Math.round(value) : startYear,
  );
  const ariaLabel = accountLabel
    ? `Liquid from year, ${accountLabel}`
    : "Liquid from year";

  return (
    <YearSliderPicker
      value={value}
      onChange={onChange}
      min={startYear}
      max={maxYear}
      allowNull
      nullLabel="Now"
      showNullButton
      ariaLabel={ariaLabel}
      dialogLabel="Choose liquid-from year"
      sliderLabel="Unlock year"
      voicePath={voicePath}
    />
  );
}
