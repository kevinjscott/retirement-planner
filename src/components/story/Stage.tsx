"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AnimatedNumber,
  EASE_OUT,
  SPRING_SOFT,
  niceCeil,
  useElementSize,
} from "@/components/story/primitives";
import { chartSeriesColor } from "@/lib/chart-colors";
import {
  deflateToToday,
  fmtMoney,
  type ScenarioInput,
  type YearRow,
} from "@/lib/projection";
import {
  POT_COPY,
  POT_ORDER,
  lifeEras,
  potBalance,
  type Pot,
  type Verdict,
  type YearBar,
} from "@/lib/story";

export type SceneId =
  | "welcome"
  | "you"
  | "spend"
  | "savings"
  | "income"
  | "costs"
  | "result";

type Layer = "curve-ambient" | "lifeline" | "bars" | "pots" | "curve";

const LAYER_OF: Record<SceneId, Layer> = {
  welcome: "curve-ambient",
  you: "lifeline",
  spend: "bars",
  savings: "pots",
  income: "bars",
  costs: "bars",
  result: "curve",
};

const POT_COLOR: Record<Pot, string> = {
  taxable: chartSeriesColor("taxable"),
  pretax: chartSeriesColor("pretax"),
  roth: chartSeriesColor("roth"),
  education: chartSeriesColor("eventFrom529"),
};

const compact = (n: number) => fmtMoney(Math.round(n), true);

type StageProps = {
  scene: SceneId;
  scenario: ScenarioInput;
  rows: YearRow[];
  bars: YearBar[];
  verdict: Verdict;
  exampleRows: YearRow[];
  exampleEndAge: number;
  exampleStartAge: number;
  exampleInflation: number;
  hoverEra: string | null;
  activePot: Pot | null;
  calendarStartYear: number;
  onCurveDone: () => void;
};

export function Stage(props: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(ref);
  const layer = LAYER_OF[props.scene];
  const ready = width > 40 && height > 40;

  return (
    <>
    <p className="vbg-story-sr">{stageSummary(props)}</p>
    <div className="vbg-story-stage" ref={ref} aria-hidden="true">
      <AnimatePresence initial={false}>
        {ready ? (
          <motion.div
            key={layer}
            className="vbg-story-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
          >
            {layer === "curve-ambient" ? (
              <CurveLayer
                key="ambient"
                width={width}
                height={height}
                rows={props.exampleRows}
                startAge={props.exampleStartAge}
                endAge={props.exampleEndAge}
                inflation={props.exampleInflation}
                depletedAge={null}
                ambient
              />
            ) : null}
            {layer === "lifeline" ? (
              <LifelineLayer
                width={width}
                height={height}
                scenario={props.scenario}
                hoverEra={props.hoverEra}
              />
            ) : null}
            {layer === "bars" ? (
              <BarsLayer
                width={width}
                height={height}
                bars={props.bars}
                calendarStartYear={props.calendarStartYear}
                showIncome={props.scene === "income" || props.scene === "costs"}
                showEvents={props.scene === "costs"}
                showToday={props.scene === "spend"}
                scene={props.scene}
              />
            ) : null}
            {layer === "pots" ? (
              <PotsLayer
                width={width}
                height={height}
                scenario={props.scenario}
                verdict={props.verdict}
                activePot={props.activePot}
              />
            ) : null}
            {layer === "curve" ? (
              <CurveLayer
                key="result"
                width={width}
                height={height}
                rows={props.rows}
                startAge={props.scenario.age}
                endAge={props.scenario.endAge}
                inflation={props.scenario.inflation}
                depletedAge={props.verdict.runOutAge}
                onDone={props.onCurveDone}
              />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
    </>
  );
}

/** Text twin of the chart, since the drawing itself is hidden from assistive tech. */
function stageSummary(props: StageProps): string {
  const { scenario, bars, verdict, calendarStartYear } = props;
  switch (LAYER_OF[props.scene]) {
    case "bars": {
      const first = bars[0];
      const last = bars[bars.length - 1];
      if (!first || !last) return "";
      const need = (b: YearBar) =>
        compact(b.living + (props.scene === "costs" ? b.events : 0));
      return `Yearly cost of living, ${need(first)} at age ${first.age} in ${calendarStartYear} dollars, rising to ${need(last)} at age ${last.age} in ${calendarStartYear + last.year} dollars.`;
    }
    case "pots": {
      const runway =
        verdict.yearsOfRunway == null
          ? ""
          : ` Savings alone cover about ${verdict.yearsOfRunway.toFixed(1)} years of spending.`;
      return `Saved today: ${compact(verdict.startTotal)}.${runway}`;
    }
    case "curve":
      return verdict.depleted && verdict.runOutAge != null
        ? `Projected balance reaches zero at age ${verdict.runOutAge}, before the plan ends at age ${scenario.endAge}.`
        : `Projected balance lasts through age ${scenario.endAge}, ending near ${compact(verdict.endingToday)} in today's dollars.`;
    case "lifeline":
      return `Plan runs from age ${scenario.age} through age ${scenario.endAge}.`;
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/* Lifeline: how long the plan has to hold                              */
/* ------------------------------------------------------------------ */

const LIFE_MIN = 30;
const LIFE_MAX = 110;

function LifelineLayer({
  width,
  height,
  scenario,
  hoverEra,
}: {
  width: number;
  height: number;
  scenario: ScenarioInput;
  hoverEra: string | null;
}) {
  const pad = Math.max(28, Math.min(48, width * 0.06));
  const x = (a: number) =>
    pad + ((a - LIFE_MIN) / (LIFE_MAX - LIFE_MIN)) * (width - pad * 2);
  const cy = Math.round(height * 0.56);
  const eras = lifeEras(scenario);
  const years = scenario.endAge - scenario.age;
  const ticks = [30, 40, 50, 60, 70, 80, 90, 100, 110];
  const levels = assignEraLevels(eras, x);
  const levelCount = Math.max(1, ...levels.map((l) => l + 1));
  const levelStep = Math.max(
    22,
    Math.min(30, (cy - 90) / Math.max(1, levelCount - 1)),
  );
  const eraTop = (i: number) => cy - 40 - levels[i]! * levelStep;

  return (
    <div className="vbg-story-lifeline">
      <svg width={width} height={height}>
        <line
          x1={x(LIFE_MIN)}
          x2={x(LIFE_MAX)}
          y1={cy}
          y2={cy}
          className="vbg-story-axis"
        />
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={cy}
              y2={cy + 6}
              className="vbg-story-axis"
            />
            <text x={x(t)} y={cy + 24} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <motion.rect
          rx={5}
          height={10}
          y={cy - 5}
          className="vbg-story-lifebar"
          initial={{ x: x(scenario.age), width: 0.01 }}
          animate={{
            x: x(scenario.age),
            width: Math.max(0.01, x(scenario.endAge) - x(scenario.age)),
          }}
          transition={SPRING_SOFT}
        />
        <AnimatePresence>
          {eras.map((era, i) => {
            const top = eraTop(i);
            const on = hoverEra === era.id;
            const dim = hoverEra != null && !on;
            return (
              <motion.g
                key={era.id}
                initial={{ opacity: 0, x: x(era.age) }}
                animate={{ opacity: dim ? 0.3 : 1, x: x(era.age) }}
                exit={{ opacity: 0 }}
                transition={{
                  ...SPRING_SOFT,
                  opacity: { duration: 0.3, delay: hoverEra ? 0 : 0.45 + i * 0.16 },
                }}
              >
                <motion.line
                  x1={0}
                  x2={0}
                  y1={cy - 8}
                  y2={top}
                  className="vbg-story-era-line"
                  data-on={on}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: 0.45 + i * 0.16, ease: EASE_OUT }}
                />
                <circle cx={0} cy={top} r={on ? 5 : 3.5} className="vbg-story-era-dot" data-on={on} />
              </motion.g>
            );
          })}
        </AnimatePresence>
      </svg>

      <AnimatePresence>
        {eras.map((era, i) => {
          const top = eraTop(i);
          const on = hoverEra === era.id;
          return (
            <motion.div
              key={era.id}
              className="vbg-story-era-label"
              data-on={on}
              style={{ top: top - 26 }}
              initial={{ opacity: 0, x: x(era.age) + 8, y: 6 }}
              animate={{
                opacity: hoverEra != null && !on ? 0.3 : 1,
                x: x(era.age) + 8,
                y: 0,
              }}
              exit={{ opacity: 0 }}
              transition={{
                ...SPRING_SOFT,
                opacity: { duration: 0.3, delay: hoverEra ? 0 : 0.6 + i * 0.16 },
              }}
            >
              <strong>{era.age % 1 ? "59½" : era.age}</strong> {era.label}
            </motion.div>
          );
        })}
      </AnimatePresence>

      <Handle
        x={x(scenario.age)}
        y={cy + 36}
        align="left"
        caption="Today"
        value={String(scenario.age)}
      />
      <Handle
        x={x(scenario.endAge)}
        y={cy + 36}
        align="right"
        caption="Plan runs through"
        value={String(scenario.endAge)}
      />
      <div className="vbg-story-years">
        <AnimatedNumber
          value={years}
          format={(n) => String(Math.round(n))}
          className="vbg-story-bignum"
        />
        <span>years to fund</span>
      </div>
    </div>
  );
}

/**
 * Stagger era labels as a descending staircase: the leftmost label sits
 * highest, so later (shorter) stems never run through an earlier label.
 */
function assignEraLevels(
  eras: { age: number; label: string }[],
  x: (age: number) => number,
): number[] {
  const levels: number[] = [];
  let start = 0;
  let clusterEnd = -Infinity;
  eras.forEach((era, i) => {
    const left = x(era.age);
    if (left < clusterEnd + 8) {
      clusterEnd = Math.max(clusterEnd, left + 24 + (era.label.length + 4) * 6.4);
    } else {
      for (let j = start; j < i; j++) levels[j] = i - 1 - j;
      start = i;
      clusterEnd = left + 24 + (era.label.length + 4) * 6.4;
    }
  });
  for (let j = start; j < eras.length; j++) levels[j] = eras.length - 1 - j;
  return levels;
}

function Handle({
  x,
  y,
  align,
  caption,
  value,
}: {
  x: number;
  y: number;
  align: "left" | "right";
  caption: string;
  value: string;
}) {
  return (
    <motion.div
      className="vbg-story-anchor"
      style={{ top: y }}
      animate={{ x }}
      transition={SPRING_SOFT}
    >
      <div className="vbg-story-handle" data-align={align}>
        <span>{caption}</span>
        <strong>{value}</strong>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Bars: what each year needs and who pays                              */
/* ------------------------------------------------------------------ */

function BarsLayer({
  width,
  height,
  bars,
  calendarStartYear,
  showIncome,
  showEvents,
  showToday,
  scene,
}: {
  width: number;
  height: number;
  bars: YearBar[];
  calendarStartYear: number;
  showIncome: boolean;
  showEvents: boolean;
  showToday: boolean;
  scene: SceneId;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const padX = Math.max(20, Math.min(40, width * 0.05));
  const top = 72;
  const bottom = 40;
  const plotW = width - padX * 2;
  const plotH = Math.max(40, height - top - bottom);
  const n = bars.length;
  const slot = plotW / Math.max(1, n);
  const bw = Math.max(2, slot * 0.7);
  const base = top + plotH;

  const segs = useMemo(
    () =>
      bars.map((b) => {
        const ev = showEvents ? b.events : 0;
        const inc = showIncome ? b.income : 0;
        const coveredLiving = Math.min(inc, b.living);
        const coveredEvents = Math.min(inc - coveredLiving, ev);
        return {
          covered: coveredLiving + coveredEvents,
          living: b.living - coveredLiving,
          events: ev - coveredEvents,
          need: b.living + ev,
          income: inc,
        };
      }),
    [bars, showIncome, showEvents],
  );
  const maxNeed = Math.max(1, ...segs.map((s) => s.need));
  const yMax = niceCeil(maxNeed * 1.08);
  const scale = (v: number) => Math.max(0.01, (v / yMax) * plotH);

  const first = bars[0];
  const last = bars[n - 1];
  const firstNeed = segs[0]?.need ?? 0;
  const lastNeed = segs[n - 1]?.need ?? 0;
  const barX = (i: number) => padX + i * slot + (slot - bw) / 2;

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = Math.floor((e.clientX - rect.left - padX) / slot);
    setHover(idx >= 0 && idx < n ? idx : null);
  };

  const hovered = hover != null ? bars[hover] : null;
  const hoveredSeg = hover != null ? segs[hover] : null;
  const axisAges = bars.filter(
    (b, i) => i === 0 || i === n - 1 || b.age % 10 === 0,
  );

  return (
    <div
      className="vbg-story-bars"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <div className="vbg-story-key">
        <KeyItem on color="var(--vbg-gray-800)" label="Cost of living" />
        <KeyItem on={showIncome} color={chartSeriesColor("income")} label="Paid by income" />
        <KeyItem on={showEvents} color={chartSeriesColor("events")} label="Big expenses" />
      </div>
      <div className="vbg-story-readout" data-on={hovered != null}>
        {hovered && hoveredSeg ? (
          <>
            <strong>
              Age {hovered.age} · {calendarStartYear + hovered.year}
            </strong>
            <span>
              {compact(hoveredSeg.need)} needed in {calendarStartYear + hovered.year} dollars
              {showIncome && hoveredSeg.income > 0
                ? ` · ${compact(Math.min(hoveredSeg.income, hoveredSeg.need))} from income`
                : ""}
            </span>
          </>
        ) : null}
      </div>
      <svg width={width} height={height}>
        <AnimatePresence>
          {showToday ? (
            <motion.line
              key="today"
              x1={padX}
              x2={width - padX}
              initial={{ opacity: 0, y1: base, y2: base }}
              animate={{
                opacity: 1,
                y1: base - scale(firstNeed),
                y2: base - scale(firstNeed),
              }}
              exit={{ opacity: 0 }}
              transition={SPRING_SOFT}
              className="vbg-story-today"
            />
          ) : null}
        </AnimatePresence>
        <line x1={padX} x2={width - padX} y1={base} y2={base} className="vbg-story-axis" />
        {axisAges.map((b) => (
          <text
            key={b.age}
            x={barX(b.year) + bw / 2}
            y={base + 22}
            textAnchor="middle"
          >
            {b.age}
          </text>
        ))}
        {bars.map((b, i) => {
          const s = segs[i]!;
          const hCovered = scale(s.covered);
          const hLiving = scale(s.living);
          const hEvents = scale(s.events);
          const dim = hover != null && hover !== i;
          const delay = scene === "spend" ? i * 0.014 : 0;
          const t = { ...SPRING_SOFT, delay };
          return (
            <motion.g
              key={b.year}
              initial={{ opacity: 0 }}
              animate={{ opacity: dim ? 0.45 : 1 }}
              transition={{ duration: 0.2 }}
            >
              <motion.rect
                x={barX(i)}
                width={bw}
                rx={Math.min(2, bw / 3)}
                fill={chartSeriesColor("income")}
                initial={{ y: base, height: 0.01 }}
                animate={{ y: base - hCovered, height: hCovered }}
                transition={t}
              />
              <motion.rect
                x={barX(i)}
                width={bw}
                rx={Math.min(2, bw / 3)}
                fill="var(--vbg-gray-800)"
                initial={{ y: base, height: 0.01 }}
                animate={{
                  y: base - hCovered - hLiving,
                  height: hLiving,
                }}
                transition={t}
              />
              <motion.rect
                x={barX(i)}
                width={bw}
                rx={Math.min(2, bw / 3)}
                fill={chartSeriesColor("events")}
                initial={{ y: base, height: 0.01 }}
                animate={{
                  y: base - hCovered - hLiving - hEvents,
                  height: hEvents,
                }}
                transition={t}
              />
            </motion.g>
          );
        })}
      </svg>
      {first && last ? (
        <>
          <BarLabel
            x={barX(0) + bw / 2}
            y={base - scale(firstNeed) - 84}
            align="left"
            caption={`Age ${first.age} · ${calendarStartYear}`}
            value={compact(firstNeed)}
            note={`in ${calendarStartYear} dollars (today)`}
          />
          <BarLabel
            x={barX(n - 1) + bw / 2}
            y={base - scale(lastNeed) - 84}
            align="right"
            caption={`Age ${last.age} · ${calendarStartYear + last.year}`}
            value={compact(lastNeed)}
            note={`in ${calendarStartYear + last.year} dollars`}
          />
        </>
      ) : null}
    </div>
  );
}

function KeyItem({
  on,
  color,
  label,
}: {
  on: boolean;
  color: string;
  label: string;
}) {
  return (
    <motion.span
      className="vbg-story-key-item"
      initial={false}
      animate={{
        opacity: on ? 1 : 0,
        width: on ? "auto" : 0,
        marginRight: on ? 14 : 0,
      }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      <i style={{ background: color }} />
      {label}
    </motion.span>
  );
}

function BarLabel({
  x,
  y,
  align,
  caption,
  value,
  note,
}: {
  x: number;
  y: number;
  align: "left" | "right";
  caption: string;
  value: string;
  note?: string;
}) {
  return (
    <motion.div
      className="vbg-story-anchor"
      animate={{ x, y: Math.max(8, y) }}
      transition={SPRING_SOFT}
    >
      <div className="vbg-story-handle" data-align={align}>
        <span>{caption}</span>
        <strong>{value}</strong>
        {note ? <span className="vbg-story-handle-note">{note}</span> : null}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Pots: what you have saved, and how far it goes before growth         */
/* ------------------------------------------------------------------ */

function PotsLayer({
  width,
  scenario,
  verdict,
  activePot,
}: {
  width: number;
  height: number;
  scenario: ScenarioInput;
  verdict: Verdict;
  activePot: Pot | null;
}) {
  const pots = POT_ORDER.map((pot) => ({
    pot,
    amount: potBalance(scenario, pot),
  }));
  const total = pots.reduce((s, p) => s + p.amount, 0);
  const horizon = Math.max(1, scenario.endAge - scenario.age);
  const runway = Math.min(horizon, verdict.yearsOfRunway ?? 0);
  const covers = (verdict.yearsOfRunway ?? 0) >= horizon;

  return (
    <div className="vbg-story-pots" style={{ width }}>
      <div className="vbg-story-pots-total">
        <span className="vbg-story-pots-label">Saved today</span>
        <AnimatedNumber
          value={total}
          format={(n) => fmtMoney(Math.round(n), true)}
          className="vbg-story-bignum"
        />
      </div>

      <div className="vbg-story-stack" data-empty={total === 0}>
        {total === 0 ? (
          <span className="vbg-story-stack-empty">
            What you have saved will stack up here
          </span>
        ) : null}
        {pots.map(({ pot, amount }) => (
          <motion.div
            key={pot}
            className="vbg-story-stack-seg"
            style={{ background: POT_COLOR[pot] }}
            initial={false}
            animate={{
              flexGrow: total > 0 ? amount / total : 0,
              opacity: activePot && activePot !== pot ? 0.35 : 1,
            }}
            transition={SPRING_SOFT}
          />
        ))}
      </div>

      <ul className="vbg-story-legend">
        {pots.map(({ pot, amount }) => (
          <AnimatePresence key={pot} initial={false}>
            {amount > 0 ? (
              <motion.li
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{
                  opacity: activePot && activePot !== pot ? 0.45 : 1,
                  height: "auto",
                }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
              >
                <i style={{ background: POT_COLOR[pot] }} />
                <span>
                  {POT_COPY[pot].title}
                  <em>{POT_COPY[pot].taxNote}</em>
                </span>
                <AnimatedNumber
                  value={amount}
                  format={(n) => fmtMoney(Math.round(n), true)}
                />
              </motion.li>
            ) : null}
          </AnimatePresence>
        ))}
      </ul>

      <div className="vbg-story-runway">
        <div className="vbg-story-runway-head">
          <span>
            Spending {fmtMoney(scenario.annualSpend, true)} a year, savings alone last
          </span>
          <strong>
            <AnimatedNumber
              value={runway}
              format={(n) => `${n.toFixed(1)} years`}
            />
          </strong>
        </div>
        <div className="vbg-story-runway-track">
          <motion.div
            className="vbg-story-runway-fill"
            initial={false}
            animate={{ width: `${(runway / horizon) * 100}%` }}
            transition={SPRING_SOFT}
          />
        </div>
        <div className="vbg-story-runway-foot">
          <span>Age {scenario.age}</span>
          <span>
            {covers
              ? "Covers the whole plan before any growth"
              : "Growth and income have to close the rest"}
          </span>
          <span>Age {scenario.endAge}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Curve: watching the balance age with you                             */
/* ------------------------------------------------------------------ */

const CURVE_POINTS = 72;

type CurvePoint = { age: number; value: number };

/** Fixed-size resample so successive curves share path structure and can morph. */
function resampleCurve(
  rows: YearRow[],
  inflation: number,
  startAge: number,
  endAge: number,
): CurvePoint[] {
  const pts: CurvePoint[] = rows.map((r) => ({
    age: r.age,
    value: Math.max(0, deflateToToday(r.total, inflation, r.year)),
  }));
  const last = pts[pts.length - 1];
  if (last && last.age < endAge) {
    pts.push({ age: Math.min(endAge, last.age + 0.01), value: 0 });
    pts.push({ age: endAge, value: 0 });
  }
  if (pts.length === 0) return [];
  const out: CurvePoint[] = [];
  for (let i = 0; i < CURVE_POINTS; i++) {
    const age = startAge + ((endAge - startAge) * i) / (CURVE_POINTS - 1);
    let j = 0;
    while (j < pts.length - 2 && pts[j + 1]!.age < age) j++;
    const a = pts[j]!;
    const b = pts[Math.min(j + 1, pts.length - 1)]!;
    const span = b.age - a.age;
    const f = span <= 0 ? 0 : Math.max(0, Math.min(1, (age - a.age) / span));
    out.push({ age, value: a.value + (b.value - a.value) * f });
  }
  return out;
}

function CurveLayer({
  width,
  height,
  rows,
  startAge,
  endAge,
  inflation,
  depletedAge,
  ambient = false,
  onDone,
}: {
  width: number;
  height: number;
  rows: YearRow[];
  startAge: number;
  endAge: number;
  inflation: number;
  depletedAge: number | null;
  ambient?: boolean;
  onDone?: () => void;
}) {
  const pts = useMemo(
    () => resampleCurve(rows, inflation, startAge, endAge),
    [rows, inflation, startAge, endAge],
  );
  const reduced = useReducedMotion() ?? false;
  const [prog, setProg] = useState(0);
  const [playing, setPlaying] = useState(true);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const controls = animate(0, 1, {
      duration: reduced ? 0.01 : ambient ? 3.2 : 3.4,
      delay: reduced ? 0 : ambient ? 0.6 : 0.5,
      ease: [0.45, 0, 0.25, 1],
      onUpdate: setProg,
      onComplete: () => {
        setPlaying(false);
        doneRef.current?.();
      },
    });
    return () => controls.stop();
  }, [ambient, reduced]);

  const padL = ambient ? 24 : 64;
  const padR = 28;
  const padT = ambient ? 56 : 64;
  const padB = 40;
  const plotW = width - padL - padR;
  const plotH = Math.max(40, height - padT - padB);
  const maxV = Math.max(1, ...pts.map((p) => p.value));
  const yMax = niceCeil(maxV * 1.08);
  const px = (age: number) =>
    padL + ((age - startAge) / Math.max(1, endAge - startAge)) * plotW;
  const py = (v: number) => padT + plotH - (v / yMax) * plotH;

  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.age).toFixed(1)} ${py(p.value).toFixed(1)}`)
    .join(" ");
  const area = pts.length
    ? `${line} L${px(endAge).toFixed(1)} ${py(0).toFixed(1)} L${px(startAge).toFixed(1)} ${py(0).toFixed(1)} Z`
    : "";

  const fIdx = prog * (pts.length - 1);
  const i0 = Math.floor(fIdx);
  const i1 = Math.min(pts.length - 1, i0 + 1);
  const frac = fIdx - i0;
  const cur = pts.length
    ? {
        age: pts[i0]!.age + (pts[i1]!.age - pts[i0]!.age) * frac,
        value: pts[i0]!.value + (pts[i1]!.value - pts[i0]!.value) * frac,
      }
    : { age: startAge, value: 0 };
  const broke = depletedAge != null && cur.age >= depletedAge;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const ageTicks = useMemo(() => {
    const out: number[] = [startAge];
    for (let a = Math.ceil((startAge + 1) / 10) * 10; a < endAge; a += 10) {
      if (a - startAge >= 4 && endAge - a >= 4) out.push(a);
    }
    out.push(endAge);
    return out;
  }, [startAge, endAge]);

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (ambient || playing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - rect.left - padL) / plotW;
    setProg(Math.max(0, Math.min(1, f)));
  };

  const lineColor = ambient ? "var(--vbg-gray-600)" : "var(--vbg-gray-1000)";

  return (
    <div className="vbg-story-curve" onPointerMove={onMove}>
      <svg width={width} height={height}>
        {!ambient
          ? gridValues.map((v) => (
              <g key={v}>
                <line
                  x1={padL}
                  x2={width - padR}
                  y1={py(v)}
                  y2={py(v)}
                  className="vbg-story-grid"
                />
                <text x={padL - 10} y={py(v) + 4} textAnchor="end">
                  {v === 0 ? "$0" : compact(v)}
                </text>
              </g>
            ))
          : null}
        {ageTicks.map((a) => (
          <text key={a} x={px(a)} y={height - 14} textAnchor="middle">
            {a}
          </text>
        ))}
        <line
          x1={padL}
          x2={width - padR}
          y1={py(0)}
          y2={py(0)}
          className="vbg-story-axis"
        />

        {depletedAge != null && !ambient ? (
          <motion.rect
            x={px(depletedAge)}
            y={padT}
            width={Math.max(0, px(endAge) - px(depletedAge))}
            height={plotH}
            className="vbg-story-gone"
            initial={{ opacity: 0 }}
            animate={{ opacity: broke ? 1 : 0 }}
            transition={{ duration: 0.5 }}
          />
        ) : null}

        <motion.path
          d={area}
          className="vbg-story-area"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, d: area }}
          transition={{
            opacity: reduced
              ? { duration: 0 }
              : { duration: 1.2, delay: ambient ? 1.2 : 1.4 },
            d: SPRING_SOFT,
          }}
          style={{ fill: lineColor }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke={lineColor}
          strokeWidth={ambient ? 2 : 2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1, d: line }}
          transition={{
            pathLength: reduced
              ? { duration: 0 }
              : {
                  duration: ambient ? 3.2 : 3.4,
                  delay: ambient ? 0.6 : 0.5,
                  ease: [0.45, 0, 0.25, 1],
                },
            d: SPRING_SOFT,
          }}
        />

        {pts.length ? (
          <g>
            <line
              x1={px(cur.age)}
              x2={px(cur.age)}
              y1={padT}
              y2={py(0)}
              className="vbg-story-scrub"
              opacity={ambient ? 0 : 1}
            />
            <circle
              cx={px(cur.age)}
              cy={py(cur.value)}
              r={ambient ? 5 : 6.5}
              className="vbg-story-dot"
              data-broke={broke}
            />
          </g>
        ) : null}
      </svg>

      {!ambient ? (
        <div className="vbg-story-curve-readout">
          <span>Age {Math.round(cur.age)}</span>
          <strong data-broke={broke}>
            {broke && cur.value < 1 ? "Savings gone" : compact(cur.value)}
          </strong>
          <em>in today&apos;s dollars</em>
        </div>
      ) : (
        <div className="vbg-story-curve-readout" data-ambient="true">
          <span>An example household</span>
          <strong>Age {Math.round(cur.age)}</strong>
        </div>
      )}
      {!ambient && !playing ? (
        <motion.p
          className="vbg-story-curve-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          Move across the chart to see any year
        </motion.p>
      ) : null}
    </div>
  );
}


