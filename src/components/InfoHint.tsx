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

function finePointerHover(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

/** Compact ? popover: hover on desktop, tap-toggle on touch; Escape / outside closes. */
export function InfoHint({ text, label = "More info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<FixedPopoverPos | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const visible = open || hovering;

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
      const maxWidth = Math.min(18 * 16, window.innerWidth - 16);
      const size = bubble
        ? { width: bubble.offsetWidth, height: bubble.offsetHeight }
        : { width: maxWidth, height: 96 };
      setPos(
        placeFixedPopover({
          anchor,
          size,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          gap: 10,
          pad: 8,
          maxWidth,
          maxHeight: Math.min(16 * 16, window.innerHeight - 16),
        }),
      );
    };
    sync();
    window.addEventListener("resize", sync);
    // Capture scroll from nested overflow:auto columns.
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [visible, text]);

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

  return (
    <span
      ref={rootRef}
      className={`vbg-custom-info${visible ? " is-open" : ""}`}
      onMouseEnter={() => {
        if (finePointerHover()) setHovering(true);
      }}
      onMouseLeave={() => {
        if (finePointerHover()) setHovering(false);
      }}
    >
      <button
        type="button"
        className="vbg-custom-info-btn"
        aria-label={label}
        aria-expanded={visible}
        aria-controls={tipId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {visible ? (
        <span
          ref={bubbleRef}
          id={tipId}
          className="vbg-custom-info-bubble"
          role="tooltip"
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
          {text}
        </span>
      ) : null}
    </span>
  );
}
