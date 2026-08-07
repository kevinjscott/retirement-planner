"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  placeFixedPopover,
  rectFromDom,
  type FixedPopoverPos,
} from "@/lib/place-fixed-popover";

export type YearSliderPickerProps = {
  /** Calendar year, duration count, or null when allowNull. */
  value: number | null;
  onChange: (year: number | null) => void;
  min: number;
  max: number;
  /** Accessible name for the trigger button. */
  ariaLabel: string;
  /** Dialog label; defaults to ariaLabel. */
  dialogLabel?: string;
  /** Meta label above the range input. */
  sliderLabel?: string;
  /**
   * When true, value may be null (shown as nullLabel).
   * How null maps onto the range is controlled by nullSliderMode.
   */
  allowNull?: boolean;
  /**
   * - "min" (default): slider at min means null (Liquid-from Now).
   * - "button": null only via the clear button; slider always commits [min, max].
   */
  nullSliderMode?: "min" | "button";
  /** Trigger / readout / clear-button label for null. Default "Now". */
  nullLabel?: string;
  /** Optional clear button next to the readout (only when allowNull). */
  showNullButton?: boolean;
  voicePath?: string;
  title?: string;
  className?: string;
};

/**
 * Compact trigger showing the current year (or nullLabel): opens a fixed
 * popover with a year slider. Slider updates live while dragging; closes on
 * pointer release / native change. Escape and click-outside dismiss.
 */
export function YearSliderPicker({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  dialogLabel,
  sliderLabel = "Year",
  allowNull = false,
  nullSliderMode = "min",
  nullLabel = "Now",
  showNullButton = allowNull,
  voicePath,
  title,
  className,
}: YearSliderPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<FixedPopoverPos | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const tipId = useId();

  const maxYear = Math.max(
    max,
    min,
    value != null && Number.isFinite(value) ? Math.round(value) : min,
  );
  const minYear = Math.min(min, maxYear);
  const nullAtMin = allowNull && nullSliderMode === "min";

  const isNull = allowNull && (value == null || !Number.isFinite(value));
  const sliderValue = isNull
    ? minYear
    : Math.min(maxYear, Math.max(minYear, Math.round(value as number)));
  const triggerLabel = isNull ? nullLabel : String(Math.round(value as number));
  const readout = isNull ? nullLabel : String(sliderValue);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const sync = () => {
      const root = rootRef.current;
      const bubble = bubbleRef.current;
      if (!root) return;
      const btn = root.querySelector("button.wealth-liquid-trigger");
      const anchor = rectFromDom((btn ?? root).getBoundingClientRect());
      const maxWidth = Math.min(16 * 16, window.innerWidth - 16);
      const size = bubble
        ? { width: bubble.offsetWidth, height: bubble.offsetHeight }
        : { width: maxWidth, height: 88 };
      setPos(
        placeFixedPopover({
          anchor,
          size,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          gap: 8,
          pad: 8,
          maxWidth,
          maxHeight: Math.min(10 * 16, window.innerHeight - 16),
          prefer: ["below", "above", "right", "left"],
        }),
      );
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [open, value, sliderValue, maxYear]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const applySlider = (n: number) => {
    const year = Math.round(n);
    if (nullAtMin && year <= minYear) {
      onChange(null);
      return;
    }
    const lo = nullAtMin ? minYear + 1 : minYear;
    onChange(Math.min(maxYear, Math.max(lo, year)));
  };

  const commitAndClose = (n: number) => {
    applySlider(n);
    setOpen(false);
  };

  // Native `change` commits after drag release / keyboard step — close then.
  // React's onChange tracks continuous `input` and must not dismiss.
  useEffect(() => {
    if (!open) return;
    const el = sliderRef.current;
    if (!el) return;
    const onCommit = () => {
      const year = Math.round(Number(el.value));
      if (nullAtMin && year <= minYear) {
        onChange(null);
      } else {
        const lo = nullAtMin ? minYear + 1 : minYear;
        onChange(Math.min(maxYear, Math.max(lo, year)));
      }
      setOpen(false);
    };
    el.addEventListener("change", onCommit);
    return () => el.removeEventListener("change", onCommit);
  }, [open, minYear, maxYear, nullAtMin, onChange]);

  const rootClass = [
    "wealth-liquid-picker",
    open ? "is-open" : "",
    isNull ? "is-now" : "is-locked",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      ref={rootRef}
      className={rootClass}
      data-voice-path={voicePath}
      title={title}
    >
      <button
        type="button"
        className="wealth-liquid-trigger"
        data-voice-path={voicePath}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={tipId}
        title={title}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          ref={bubbleRef}
          id={tipId}
          className="wealth-liquid-bubble"
          role="dialog"
          aria-label={dialogLabel ?? ariaLabel}
          data-placement={pos?.placement}
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            maxWidth: pos?.maxWidth,
            maxHeight: pos?.maxHeight,
            visibility: pos ? "visible" : "hidden",
            pointerEvents: pos ? "auto" : "none",
          }}
        >
          <div className="wealth-liquid-bubble-head">
            <span className="wealth-liquid-readout">{readout}</span>
            {allowNull && showNullButton ? (
              <button
                type="button"
                className={`wealth-liquid-now-btn${isNull ? " is-active" : ""}`}
                aria-pressed={isNull}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {nullLabel}
              </button>
            ) : null}
          </div>
          <label className="wealth-liquid-slider-label">
            <span className="vbg-meta">{sliderLabel}</span>
            <input
              ref={sliderRef}
              type="range"
              className="wealth-liquid-slider"
              min={minYear}
              max={maxYear}
              step={1}
              value={sliderValue}
              aria-valuetext={isNull ? nullLabel : String(sliderValue)}
              onChange={(e) => applySlider(Number(e.target.value))}
              onPointerUp={(e) => {
                commitAndClose(Number((e.target as HTMLInputElement).value));
              }}
            />
            <span className="wealth-liquid-slider-ends vbg-meta" aria-hidden="true">
              <span>{nullAtMin ? nullLabel : String(minYear)}</span>
              <span>{maxYear}</span>
            </span>
          </label>
        </div>
      ) : null}
    </span>
  );
}
