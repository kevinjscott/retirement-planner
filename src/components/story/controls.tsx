"use client";

import { motion } from "framer-motion";
import { useId, type CSSProperties, type ReactNode } from "react";
import {
  DeferredNumberInput,
  formatWithCommas,
} from "@/components/DeferredNumberInput";
import { SPRING_SNAPPY } from "@/components/story/primitives";

export function StorySlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  valueText,
  marks,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  label: string;
  valueText?: string;
  marks?: { value: number; label: string }[];
}) {
  const span = Math.max(1e-9, max - min);
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
  return (
    <div className="vbg-story-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, value))}
        aria-label={label}
        aria-valuetext={valueText}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {marks ? (
        <div className="vbg-story-slider-marks" aria-hidden="true">
          {marks.map((m) => (
            <span
              key={m.value}
              style={{ left: `${((m.value - min) / span) * 100}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Large inline number that reads as part of a sentence. */
export function InlineNumber({
  value,
  onCommit,
  min,
  max,
  label,
  prefix,
  suffix,
  format,
  size = "lg",
  decimal,
}: {
  value: number;
  onCommit: (n: number) => void;
  min: number;
  max: number;
  label: string;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
  size?: "lg" | "md";
  decimal?: boolean;
}) {
  const id = useId();
  const digits = Math.max(2, String(Math.round(max)).length);
  return (
    <span className={`vbg-story-inline vbg-story-inline-${size}`}>
      {prefix ? <span className="vbg-story-inline-affix">{prefix}</span> : null}
      <DeferredNumberInput
        id={id}
        aria-label={label}
        inputMode={decimal ? "decimal" : "numeric"}
        value={value}
        format={format ?? formatWithCommas}
        style={{ width: `${digits + (format ? 3 : 1.4)}ch` }}
        onCommit={(n) => {
          if (n === null) return;
          onCommit(Math.max(min, Math.min(max, decimal ? n : Math.round(n))));
        }}
      />
      {suffix ? <span className="vbg-story-inline-affix">{suffix}</span> : null}
    </span>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  display,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  display: string;
}) {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return (
    <span className="vbg-story-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="vbg-button"
        data-variant="secondary"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, round(value - step)))}
      >
        −
      </button>
      <output aria-live="polite">{display}</output>
      <button
        type="button"
        className="vbg-button"
        data-variant="secondary"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, round(value + step)))}
      >
        +
      </button>
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | null;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const groupId = useId();
  return (
    <div className="vbg-story-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className="vbg-story-segment"
            data-on={on}
            onClick={() => onChange(o.value)}
          >
            {on ? (
              <motion.span
                layoutId={`seg-${groupId}`}
                className="vbg-story-segment-pill"
                transition={SPRING_SNAPPY}
              />
            ) : null}
            <span className="vbg-story-segment-label">{o.label}</span>
            {o.hint ? (
              <span className="vbg-story-segment-hint">{o.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ChoiceChip({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      className="vbg-story-chip"
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={SPRING_SNAPPY}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="vbg-story-chip-plus" aria-hidden="true">
        +
      </span>
      {children}
    </motion.button>
  );
}
