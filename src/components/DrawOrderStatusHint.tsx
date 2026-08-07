"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  formatBestDrawOrderEvidence,
  formatDrawOrderRunway,
  type DrawOrderComparison,
  type DrawOrderStatusTone,
} from "@/lib/insights";
import {
  placeFixedPopover,
  rectFromDom,
  type FixedPopoverPos,
} from "@/lib/place-fixed-popover";
import { fmtMoney } from "@/lib/projection";

function finePointerHover(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

const STATUS_LABEL: Record<DrawOrderStatusTone, string> = {
  best: "Current draw order looks best",
  close: "Draw order is tied or close",
  worse: "Another draw order looks better",
};

/**
 * Compact status circle next to the draw-order select: hover/click opens a
 * fixed popover with ranking evidence (InfoHint-style open/close).
 */
export function DrawOrderStatusHint({
  comparison,
  currentOrder,
  onUseBest,
}: {
  comparison: DrawOrderComparison;
  currentOrder: string;
  onUseBest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<FixedPopoverPos | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const visible = open || hovering;
  const tone = comparison.status;

  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const sync = () => {
      const root = rootRef.current;
      const bubble = bubbleRef.current;
      if (!root) return;
      const btn = root.querySelector("button");
      const anchor = rectFromDom((btn ?? root).getBoundingClientRect());
      const maxWidth = Math.min(22 * 16, window.innerWidth - 16);
      const size = bubble
        ? { width: bubble.offsetWidth, height: bubble.offsetHeight }
        : { width: maxWidth, height: 200 };
      setPos(
        placeFixedPopover({
          anchor,
          size,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          gap: 10,
          pad: 8,
          maxWidth,
          maxHeight: Math.min(22 * 16, window.innerHeight - 16),
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
  }, [visible, comparison]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setHovering(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setHovering(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [visible]);

  const title =
    comparison.currentIsBest
      ? "Draw order looks best for this plan"
      : `Switching to ${comparison.best.label} looks better`;

  return (
    <span
      ref={rootRef}
      className={`vbg-custom-draw-status${visible ? " is-open" : ""}`}
      onMouseEnter={() => {
        if (finePointerHover()) setHovering(true);
      }}
      onMouseLeave={() => {
        if (finePointerHover()) setHovering(false);
      }}
    >
      <button
        type="button"
        className={`vbg-custom-draw-status-btn is-${tone}`}
        aria-label={STATUS_LABEL[tone]}
        aria-expanded={visible}
        aria-controls={tipId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      />
      {visible ? (
        <span
          ref={bubbleRef}
          id={tipId}
          className="vbg-custom-draw-status-bubble"
          role="dialog"
          aria-label="Draw order comparison"
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
          <p className="vbg-custom-draw-order-title">{title}</p>
          <p className="vbg-meta vbg-custom-draw-order-rule">
            {comparison.rankingRule}
          </p>
          <p className="vbg-meta">
            Pretax means Trad IRA / 401(k) withdrawals.
          </p>
          {comparison.currentIsBest ? (
            <p className="vbg-meta vbg-custom-draw-order-evidence">
              {formatBestDrawOrderEvidence(comparison)}
            </p>
          ) : (
            <>
              <table className="vbg-custom-draw-order-table">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Ending (today&apos;s $)</th>
                    <th scope="col">Runway</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.ranked.map((o) => (
                    <tr
                      key={o.order}
                      className={
                        o.order === comparison.best.order
                          ? "is-best-row"
                          : o.order === currentOrder
                            ? "is-current-row"
                            : undefined
                      }
                    >
                      <td>
                        {o.label}
                        {o.order === currentOrder ? " · current" : null}
                        {o.order === comparison.best.order ? " · best" : null}
                      </td>
                      <td className="vbg-numeric">
                        {fmtMoney(o.endingToday, true)}
                      </td>
                      <td>{formatDrawOrderRunway(o)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="vbg-button"
                data-variant="secondary"
                onClick={() => {
                  onUseBest();
                  setOpen(false);
                  setHovering(false);
                }}
              >
                Use {comparison.best.label}
              </button>
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}
