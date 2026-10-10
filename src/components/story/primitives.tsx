"use client";

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const SPRING_SOFT = {
  type: "spring",
  stiffness: 170,
  damping: 24,
  mass: 0.8,
} as const;

export const SPRING_SNAPPY = {
  type: "spring",
  stiffness: 380,
  damping: 30,
} as const;

/** A number that glides to its next value instead of jumping. */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 150, damping: 24, mass: 0.7 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => {
    mv.set(value);
  }, [mv, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

const wordVariants: Variants = {
  hidden: { opacity: 0, y: "0.45em", filter: "blur(6px)" },
  shown: {
    opacity: 1,
    y: "0em",
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: EASE_OUT },
  },
};

/** Heading that lands one word at a time. */
export function Words({
  text,
  className,
  delay = 0,
  stagger = 0.045,
}: {
  text: string;
  className?: string;
  delay?: number;
  stagger?: number;
}) {
  const words = text.split(" ");
  return (
    <motion.span
      className={className}
      initial="hidden"
      animate="shown"
      aria-label={text}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
    >
      {words.map((w, i) => (
        <Fragment key={`${w}-${i}`}>
          <motion.span
            aria-hidden="true"
            variants={wordVariants}
            className="vbg-story-word"
          >
            {w}
          </motion.span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </motion.span>
  );
}

/** Rises into place; children of a staggering parent inherit timing. */
export const riseVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setSize((prev) => {
        const next = { width: el.clientWidth, height: el.clientHeight };
        return prev.width === next.width && prev.height === next.height
          ? prev
          : next;
      });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Chart ceiling that holds still through small edits, then snaps to the next
 * round number, so a dragged slider changes bar heights instead of rescaling
 * every bar by the same factor.
 */
export function useStableCeiling(need: number): number {
  const [held, setHeld] = useState(() => niceCeil(need * 1.08));
  if (need > held * 0.97 || need < held * 0.45) {
    const next = niceCeil(need * 1.08);
    if (next !== held) setHeld(next);
  }
  return held;
}

export function niceCeil(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const f = n / base;
  const step = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : f <= 7.5 ? 7.5 : 10;
  return step * base;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(q.matches);
    read();
    q.addEventListener("change", read);
    return () => q.removeEventListener("change", read);
  }, []);
  return reduced;
}
