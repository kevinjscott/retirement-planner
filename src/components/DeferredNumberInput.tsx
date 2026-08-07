"use client";

import {
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";

type DeferredNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  /** Committed numeric value. Use `null` when the field may be empty. */
  value: number | null;
  /** Called on blur / Enter with the parsed number (or null if empty + allowEmpty). */
  onCommit: (value: number | null) => void;
  /** Format committed value for display when not editing. */
  format?: (value: number) => string;
  /** Parse draft text; return null if incomplete/invalid (reverts on blur). */
  parse?: (raw: string) => number | null;
  /** When true, empty draft commits as null. Otherwise empty reverts. */
  allowEmpty?: boolean;
  /** Shown when value is null and not editing. */
  emptyDisplay?: string;
};

function defaultFormat(n: number): string {
  return String(n);
}

/** Thousand-separated display for money amounts (parse still strips commas). */
export function formatWithCommas(n: number): string {
  const [intPart, frac] = String(n).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

function defaultParse(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (t === "" || t === "-" || t === "." || t === "-.") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Number field that keeps a local string draft while focused so typing
 * (clear, partial years like "203", etc.) is not rewritten on every keystroke.
 */
export function DeferredNumberInput({
  value,
  onCommit,
  format = defaultFormat,
  parse = defaultParse,
  allowEmpty = false,
  emptyDisplay = "",
  inputMode = "decimal",
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: DeferredNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const committed =
    value === null || !Number.isFinite(value) ? emptyDisplay : format(value);
  const display = draft !== null ? draft : committed;

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (
      trimmed === "" ||
      trimmed === "-" ||
      trimmed === "." ||
      trimmed === "-."
    ) {
      if (allowEmpty) onCommit(null);
      setDraft(null);
      return;
    }
    const n = parse(trimmed);
    if (n === null) {
      setDraft(null);
      return;
    }
    onCommit(n);
    setDraft(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
    onKeyDown?.(e);
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode={inputMode}
      value={display}
      onFocus={(e) => {
        setDraft(committed);
        onFocus?.(e);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit(draft ?? e.target.value);
        onBlur?.(e);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
