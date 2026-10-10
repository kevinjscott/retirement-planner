"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import {
  ChoiceChip,
  InlineNumber,
  Segmented,
  Stepper,
  StorySlider,
} from "@/components/story/controls";
import {
  AnimatedNumber,
  EASE_OUT,
  SPRING_SOFT,
  Words,
  niceCeil,
  riseVariants,
} from "@/components/story/primitives";
import {
  EVENT_KIND_LABEL,
  fmtMoney,
  fmtPct,
  type IncomeStream,
  type LifeEvent,
  type LifeEventKind,
  type ScenarioInput,
  type YearRow,
} from "@/lib/projection";
import {
  INCOME_PRESET_COPY,
  POT_COPY,
  POT_ORDER,
  RISK_COPY,
  STORY_EVENT_COPY,
  applyRiskStyle,
  currentRiskStyle,
  lifeEras,
  newIncome,
  newStoryEvent,
  normalize529Links,
  potBalance,
  riskRate,
  setPotBalance,
  type IncomePreset,
  type Pot,
  type RiskStyle,
  type Verdict,
  type YearBar,
} from "@/lib/story";
import { US_STATES, getUsState, type UsStateCode } from "@/lib/us-taxes";

const money = (n: number) => fmtMoney(Math.round(n), true);

export type SceneProps = {
  scenario: ScenarioInput;
  update: (fn: (s: ScenarioInput) => ScenarioInput) => void;
  bars: YearBar[];
  rows: YearRow[];
  verdict: Verdict;
};

function SceneShell({
  title,
  titleKey,
  lede,
  children,
}: {
  title: string;
  titleKey?: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <motion.div
      className="vbg-story-scene"
      initial="hidden"
      animate="shown"
      transition={{ staggerChildren: 0.09, delayChildren: 0.3 }}
    >
      <h2 className="vbg-story-title" tabIndex={-1} data-story-title>
        <Words key={titleKey ?? "title"} text={title} />
      </h2>
      {lede ? (
        <motion.p className="vbg-story-lede" variants={riseVariants}>
          {lede}
        </motion.p>
      ) : null}
      {children}
    </motion.div>
  );
}

function Rise({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={riseVariants}>
      {children}
    </motion.div>
  );
}

/** A line of live narration that updates as the numbers move. */
function Narration({ children }: { children: ReactNode }) {
  return (
    <Rise className="vbg-story-narration">
      <span className="vbg-story-narration-mark" aria-hidden="true" />
      <p aria-live="polite">{children}</p>
    </Rise>
  );
}

/* ------------------------------------------------------------------ */

export function WelcomeScene({
  onBuild,
  onExample,
  onSkip,
  importSlot,
}: {
  onBuild: () => void;
  onExample: () => void;
  onSkip: () => void;
  importSlot: ReactNode;
}) {
  return (
    <SceneShell
      title="Will your money last as long as you do?"
      lede="Tell us about your life, one question at a time, and watch your plan take shape. It takes about two minutes."
    >
      <Rise className="vbg-story-actions">
        <button
          type="button"
          className="vbg-button vbg-story-cta"
          data-variant="primary"
          onClick={onBuild}
        >
          Build my plan
          <span aria-hidden="true">→</span>
        </button>
        <button
          type="button"
          className="vbg-button vbg-story-cta"
          data-variant="secondary"
          onClick={onExample}
        >
          Walk through an example
        </button>
      </Rise>
      <Rise className="vbg-story-quiet">
        {importSlot}
        <button type="button" className="vbg-story-link" onClick={onSkip}>
          Skip to the full planner
        </button>
      </Rise>
      <Rise>
        <p className="vbg-meta vbg-story-fineprint">
          Your numbers stay in this browser.
        </p>
      </Rise>
    </SceneShell>
  );
}

/* ------------------------------------------------------------------ */

export function YouScene({
  scenario,
  update,
  imported,
  onHoverEra,
}: SceneProps & {
  imported: boolean;
  onHoverEra: (id: string | null) => void;
}) {
  const eras = lifeEras(scenario);
  return (
    <SceneShell
      title="First, how long does this money need to last?"
      lede={
        imported
          ? "We pulled in what you shared. Check each answer as we go, and change anything that is off."
          : "Plan past the age you expect to reach. Running short at 85 is much worse than having a cushion at 95."
      }
    >
      <Rise className="vbg-story-sentence">
        <p>
          I&apos;m{" "}
          <InlineNumber
            label="Age now"
            value={scenario.age}
            min={30}
            max={90}
            onCommit={(age) =>
              update((s) => ({
                ...s,
                age,
                endAge: Math.max(s.endAge, age + 1),
              }))
            }
          />{" "}
          today.
        </p>
        <StorySlider
          label="Age now"
          min={30}
          max={90}
          value={scenario.age}
          onChange={(age) =>
            update((s) => ({ ...s, age, endAge: Math.max(s.endAge, age + 1) }))
          }
        />
      </Rise>
      <Rise className="vbg-story-sentence">
        <p>
          Plan for my money to last through age{" "}
          <InlineNumber
            label="Plan through age"
            value={scenario.endAge}
            min={scenario.age + 1}
            max={110}
            onCommit={(endAge) => update((s) => ({ ...s, endAge }))}
          />
          .
        </p>
        <StorySlider
          label="Plan through age"
          min={31}
          max={110}
          value={scenario.endAge}
          onChange={(endAge) =>
            update((s) => ({ ...s, endAge: Math.max(endAge, s.age + 1) }))
          }
        />
      </Rise>
      {eras.length > 0 ? (
        <Rise className="vbg-story-eras">
          <p className="vbg-story-subhead">Rules that change along the way</p>
          <ul>
            {eras.map((era) => (
              <motion.li
                key={era.id}
                layout
                tabIndex={0}
                onMouseEnter={() => onHoverEra(era.id)}
                onMouseLeave={() => onHoverEra(null)}
                onFocus={() => onHoverEra(era.id)}
                onBlur={() => onHoverEra(null)}
                transition={SPRING_SOFT}
              >
                <strong>{era.age % 1 ? "59½" : era.age}</strong>
                <span>
                  {era.label}
                  <em>{era.detail}</em>
                </span>
              </motion.li>
            ))}
          </ul>
        </Rise>
      ) : null}
    </SceneShell>
  );
}

/* ------------------------------------------------------------------ */

export function SpendScene({ scenario, update, bars }: SceneProps) {
  const last = bars[bars.length - 1];
  const state = getUsState(scenario.stateCode);
  const max = scenario.annualSpend > 300_000 ? niceCeil(scenario.annualSpend * 1.1) : 300_000;
  return (
    <SceneShell
      title="What does a good year cost you?"
      lede="Count everything: housing, food, travel, health care, gifts. Use today's prices."
    >
      <Rise className="vbg-story-sentence">
        <p>
          About{" "}
          <InlineNumber
            label="Annual spending in today's dollars"
            prefix="$"
            value={scenario.annualSpend}
            min={0}
            max={2_000_000}
            onCommit={(annualSpend) =>
              update((s) => ({ ...s, spendMode: "fixed", annualSpend }))
            }
          />{" "}
          a year.
        </p>
        <StorySlider
          label="Annual spending"
          valueText={`${money(scenario.annualSpend)} a year`}
          min={20_000}
          max={max}
          step={1_000}
          value={scenario.annualSpend}
          onChange={(annualSpend) =>
            update((s) => ({ ...s, spendMode: "fixed", annualSpend }))
          }
        />
        <p className="vbg-meta">
          <AnimatedNumber
            value={scenario.annualSpend / 12}
            format={(n) => `About ${fmtMoney(Math.round(n / 50) * 50)} a month`}
          />
        </p>
      </Rise>

      <Rise className="vbg-story-sentence vbg-story-sentence-sm">
        <p>
          Prices rise{" "}
          <Stepper
            label="Inflation"
            value={scenario.inflation}
            min={0}
            max={0.08}
            step={0.005}
            display={fmtPct(scenario.inflation)}
            onChange={(inflation) => update((s) => ({ ...s, inflation }))}
          />{" "}
          a year.
        </p>
      </Rise>

      <Rise className="vbg-story-sentence vbg-story-sentence-sm">
        <p>
          I live in{" "}
          <span className="vbg-story-select">
            <select
              aria-label="State"
              value={scenario.stateCode}
              onChange={(e) =>
                update((s) => ({
                  ...s,
                  stateCode: e.target.value as UsStateCode,
                }))
              }
            >
              {US_STATES.map((st) => (
                <option key={st.code} value={st.code}>
                  {st.name}
                </option>
              ))}
            </select>
          </span>
          .
        </p>
        <p className="vbg-meta">
          {state.ordinaryRate === 0 || !state.taxesRetirementDistributions
            ? `${state.name} does not tax retirement withdrawals.`
            : `${state.name} taxes retirement withdrawals at about ${fmtPct(state.ordinaryRate)}, on top of federal tax.`}
        </p>
      </Rise>

      {last ? (
        <Narration>
          Inflation turns {money(scenario.annualSpend)} today into{" "}
          <strong>
            <AnimatedNumber value={last.living} format={money} />
          </strong>{" "}
          a year by age {last.age}.
        </Narration>
      ) : null}
    </SceneShell>
  );
}

/* ------------------------------------------------------------------ */

const POT_SLIDER: Record<Pot, { max: number; step: number }> = {
  taxable: { max: 2_000_000, step: 5_000 },
  pretax: { max: 2_000_000, step: 5_000 },
  roth: { max: 1_000_000, step: 5_000 },
  education: { max: 250_000, step: 1_000 },
};

export function SavingsScene({
  scenario,
  update,
  verdict,
  onActivePot,
}: SceneProps & { onActivePot: (pot: Pot | null) => void }) {
  const [showEducation, setShowEducation] = useState(
    potBalance(scenario, "education") > 0,
  );
  const style = currentRiskStyle(scenario);
  const visible = POT_ORDER.filter(
    (p) => p !== "education" || showEducation || potBalance(scenario, p) > 0,
  );
  const total = visible.reduce((s, p) => s + potBalance(scenario, p), 0);
  const horizon = scenario.endAge - scenario.age;
  const runway = verdict.yearsOfRunway ?? 0;

  return (
    <SceneShell
      title="What have you saved so far?"
      lede="Where the money sits matters, because each kind is taxed differently on the way out. Add what you have in each."
    >
      <div className="vbg-story-pot-list">
        {visible.map((pot) => {
          const balance = potBalance(scenario, pot);
          const cfg = POT_SLIDER[pot];
          const max = balance > cfg.max ? niceCeil(balance * 1.1) : cfg.max;
          const accounts = scenario.accounts.filter((a) =>
            pot === "pretax"
              ? a.kind === "traditional" || a.kind === "401k"
              : a.kind === (pot === "education" ? "529" : pot),
          ).length;
          return (
            <Rise key={pot}>
              <motion.div
                className="vbg-story-pot"
                layout
                data-filled={balance > 0}
                onMouseEnter={() => onActivePot(pot)}
                onMouseLeave={() => onActivePot(null)}
                onFocus={() => onActivePot(pot)}
                onBlur={() => onActivePot(null)}
              >
                <div className="vbg-story-pot-head">
                  <span>
                    <strong>{POT_COPY[pot].title}</strong>
                    <em>{POT_COPY[pot].taxNote}</em>
                  </span>
                  <InlineNumber
                    size="md"
                    label={`${POT_COPY[pot].title} balance`}
                    prefix="$"
                    value={balance}
                    min={0}
                    max={50_000_000}
                    onCommit={(n) => update((s) => setPotBalance(s, pot, n))}
                  />
                </div>
                <StorySlider
                  label={`${POT_COPY[pot].title} balance`}
                  valueText={money(balance)}
                  min={0}
                  max={max}
                  step={cfg.step}
                  value={balance}
                  onChange={(n) => update((s) => setPotBalance(s, pot, n))}
                />
                {accounts > 1 ? (
                  <p className="vbg-meta">
                    {accounts} accounts combined. Split them out in the planner.
                  </p>
                ) : null}
              </motion.div>
            </Rise>
          );
        })}
        {!showEducation && potBalance(scenario, "education") === 0 ? (
          <Rise>
            <ChoiceChip onClick={() => setShowEducation(true)}>
              A 529 college fund
            </ChoiceChip>
          </Rise>
        ) : null}
      </div>

      <Rise className="vbg-story-invest">
        <p className="vbg-story-subhead">How is it invested?</p>
        <Segmented<RiskStyle>
          label="Investment style"
          value={style}
          onChange={(s) => update((sc) => applyRiskStyle(sc, s))}
          options={(Object.keys(RISK_COPY) as RiskStyle[]).map((k) => ({
            value: k,
            label: RISK_COPY[k].label,
            hint: `about ${fmtPct(riskRate(k))}`,
          }))}
        />
        <p className="vbg-meta">
          {style
            ? `${RISK_COPY[style].blurb}. Each account's return is editable in the planner.`
            : "Your accounts use different mixes. Pick one to apply it everywhere, or keep them as they are."}
        </p>
      </Rise>

      {total > 0 ? (
        <Narration>
          <strong>
            <AnimatedNumber value={total} format={money} />
          </strong>{" "}
          covers about{" "}
          <strong>
            <AnimatedNumber
              value={runway}
              format={(n) => `${Math.min(n, horizon).toFixed(1)}`}
            />
          </strong>{" "}
          of your {horizon} years before it earns anything.
        </Narration>
      ) : (
        <Narration>Add at least one account to keep going.</Narration>
      )}
    </SceneShell>
  );
}

/* ------------------------------------------------------------------ */

export function IncomeScene({ scenario, update, bars }: SceneProps) {
  const last = bars[bars.length - 1];
  const coverage =
    last && last.living + last.events > 0
      ? last.covered / (last.living + last.events)
      : 0;
  const addPreset = (p: IncomePreset) =>
    update((s) => ({ ...s, incomes: [...s.incomes, newIncome(p, s)] }));
  const patchIncome = (id: string, partial: Partial<IncomeStream>) =>
    update((s) => ({
      ...s,
      incomes: s.incomes.map((i) => (i.id === id ? { ...i, ...partial } : i)),
    }));
  const hasSS = scenario.incomes.some((i) => /social/i.test(i.label));

  return (
    <SceneShell
      title="What will keep coming in?"
      lede="Every dollar of income is a dollar you don't pull from savings. Watch the green fill in on the right."
    >
      <Rise className="vbg-story-chips">
        {(Object.keys(INCOME_PRESET_COPY) as IncomePreset[])
          .filter((p) => !(p === "social-security" && hasSS))
          .map((p) => (
            <ChoiceChip key={p} onClick={() => addPreset(p)}>
              {INCOME_PRESET_COPY[p].label}
            </ChoiceChip>
          ))}
      </Rise>

      <motion.div layout className="vbg-story-cards">
        <AnimatePresence initial={false}>
          {scenario.incomes.map((inc) => (
            <motion.div
              key={inc.id}
              layout
              className="vbg-story-card"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
              transition={SPRING_SOFT}
            >
              <div className="vbg-story-card-head">
                <input
                  className="vbg-story-card-title"
                  aria-label="Income name"
                  value={inc.label}
                  onChange={(e) => patchIncome(inc.id, { label: e.target.value })}
                />
                <button
                  type="button"
                  className="vbg-story-remove"
                  aria-label={`Remove ${inc.label || "income"}`}
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      incomes: s.incomes.filter((i) => i.id !== inc.id),
                    }))
                  }
                >
                  ×
                </button>
              </div>
              <div className="vbg-story-card-row">
                <InlineNumber
                  size="md"
                  label={`${inc.label} per year`}
                  prefix="$"
                  suffix="a year"
                  value={inc.annualAmount}
                  min={0}
                  max={5_000_000}
                  onCommit={(annualAmount) => patchIncome(inc.id, { annualAmount })}
                />
              </div>
              <div className="vbg-story-card-slider">
                <label>
                  Starts at age <strong>{inc.startAge}</strong>
                </label>
                <StorySlider
                  label={`${inc.label} start age`}
                  min={scenario.age}
                  max={scenario.endAge}
                  value={inc.startAge}
                  marks={
                    /social/i.test(inc.label)
                      ? [
                          { value: 62, label: "62" },
                          { value: 67, label: "67" },
                          { value: 70, label: "70" },
                        ].filter(
                          (m) => m.value >= scenario.age && m.value <= scenario.endAge,
                        )
                      : undefined
                  }
                  onChange={(startAge) => patchIncome(inc.id, { startAge })}
                />
              </div>
              <label className="vbg-story-check">
                <input
                  type="checkbox"
                  checked={inc.inflates}
                  onChange={(e) => patchIncome(inc.id, { inflates: e.target.checked })}
                />
                <span>Rises with inflation</span>
              </label>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <Narration>
        {scenario.incomes.length === 0 ? (
          "With no income, savings pay for everything. Add what applies, or move on."
        ) : (
          <>
            By age {last?.age}, income pays for{" "}
            <strong>
              <AnimatedNumber
                value={coverage * 100}
                format={(n) => `${Math.round(n)}%`}
              />
            </strong>{" "}
            of what you spend.
          </>
        )}
      </Narration>
    </SceneShell>
  );
}

/* ------------------------------------------------------------------ */

export function CostsScene({ scenario, update, rows }: SceneProps) {
  const horizon = Math.max(1, scenario.endAge - scenario.age);
  const add = (kind: LifeEventKind) =>
    update((s) =>
      normalize529Links({
        ...s,
        events: [...s.events, newStoryEvent(kind, s)],
      }),
    );
  const patchEvent = (id: string, partial: Partial<LifeEvent>) =>
    update((s) => ({
      ...s,
      events: s.events.map((e) => (e.id === id ? { ...e, ...partial } : e)),
    }));
  const totalCost = rows.reduce((s, r) => s + r.eventCost, 0);
  const college = rows.reduce((s, r) => s + r.collegeCost, 0);
  const from529 = rows.reduce((s, r) => s + r.eventFrom529, 0);

  return (
    <SceneShell
      title="Anything big on the horizon?"
      lede="One-time and short-run costs are what quietly break plans. Add the ones you can see coming. Skip this if there are none."
    >
      <Rise className="vbg-story-chips">
        {(Object.keys(STORY_EVENT_COPY) as LifeEventKind[]).map((k) => (
          <ChoiceChip key={k} onClick={() => add(k)}>
            {STORY_EVENT_COPY[k].label}
          </ChoiceChip>
        ))}
      </Rise>

      <motion.div layout className="vbg-story-cards">
        <AnimatePresence initial={false}>
          {scenario.events.map((ev) => (
            <motion.div
              key={ev.id}
              layout
              className="vbg-story-card"
              data-kind={ev.kind}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
              transition={SPRING_SOFT}
            >
              <div className="vbg-story-card-head">
                <input
                  className="vbg-story-card-title"
                  aria-label="Expense name"
                  value={ev.label}
                  placeholder={EVENT_KIND_LABEL[ev.kind]}
                  onChange={(e) => patchEvent(ev.id, { label: e.target.value })}
                />
                <button
                  type="button"
                  className="vbg-story-remove"
                  aria-label={`Remove ${ev.label || "expense"}`}
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      events: s.events.filter((e) => e.id !== ev.id),
                      accounts: s.accounts.map((a) =>
                        a.linkedEventId === ev.id
                          ? { ...a, linkedEventId: null }
                          : a,
                      ),
                    }))
                  }
                >
                  ×
                </button>
              </div>
              <div className="vbg-story-card-row">
                <InlineNumber
                  size="md"
                  label={`${ev.label} cost`}
                  prefix="$"
                  suffix={ev.durationYears > 1 ? "a year" : "total"}
                  value={ev.annualCost}
                  min={0}
                  max={5_000_000}
                  onCommit={(annualCost) => patchEvent(ev.id, { annualCost })}
                />
                <Stepper
                  label="Years it lasts"
                  value={ev.durationYears}
                  min={1}
                  max={Math.max(1, horizon - ev.startYear)}
                  display={`${ev.durationYears} ${ev.durationYears === 1 ? "year" : "years"}`}
                  onChange={(durationYears) => patchEvent(ev.id, { durationYears })}
                />
              </div>
              <div className="vbg-story-card-slider">
                <label>
                  {ev.startYear === 0 ? "Starts this year" : `Starts in ${ev.startYear} years`}{" "}
                  <span className="vbg-meta">at age {scenario.age + ev.startYear}</span>
                </label>
                <StorySlider
                  label={`${ev.label} start`}
                  min={0}
                  max={Math.max(0, horizon - 1)}
                  value={ev.startYear}
                  onChange={(startYear) => patchEvent(ev.id, { startYear })}
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <Narration>
        {scenario.events.length === 0 ? (
          "Nothing big planned. The plan only has to cover everyday living."
        ) : (
          <>
            These add up to{" "}
            <strong>
              <AnimatedNumber value={totalCost} format={money} />
            </strong>
            {college > 0 && from529 > 0
              ? `, and 529s pay ${Math.round((from529 / college) * 100)}% of college.`
              : "."}
          </>
        )}
      </Narration>
    </SceneShell>
  );
}

/* ------------------------------------------------------------------ */

export function ResultScene({
  scenario,
  update,
  verdict,
  played,
}: SceneProps & { played: boolean }) {
  const short = verdict.depleted && verdict.runOutAge != null;
  const title = !played
    ? "Running your numbers"
    : short
      ? `Your savings run out at age ${verdict.runOutAge}.`
      : `Your money lasts through age ${verdict.endAge}.`;
  const firstIncome = [...scenario.incomes].sort(
    (a, b) => a.startAge - b.startAge,
  )[0];

  return (
    <SceneShell
      title={title}
      titleKey={!played ? "running" : short ? "short" : "ok"}
      lede={
        !played ? (
          <span className="vbg-story-working">
            <ThinkingOrb state="working" size={20} theme="light" aria-label="Working" />
            Aging your savings year by year, with taxes, inflation and every cost you added.
          </span>
        ) : short ? (
          `That is ${verdict.endAge - (verdict.runOutAge ?? 0)} years short of your plan. Try the levers below to see what closes the gap.`
        ) : (
          `You would still have about ${money(verdict.endingToday)} in today's dollars. Try the levers below to see how much room you have.`
        )
      }
    >
      <AnimatePresence>
        {played ? (
          <motion.div
            className="vbg-story-result"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.2 }}
          >
            <div className="vbg-story-verdict" data-short={short}>
              <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
                <circle cx="14" cy="14" r="12.5" fill="none" strokeWidth="1.5" />
                <motion.path
                  d={short ? "M9.5 9.5l9 9M18.5 9.5l-9 9" : "M8.5 14.5l3.8 3.8 7.2-8"}
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, delay: 0.5, ease: EASE_OUT }}
                />
              </svg>
              <span>{short ? "Falls short of your plan" : "On track for your plan"}</span>
            </div>

            <dl className="vbg-story-facts">
              <div>
                <dt>Starting savings</dt>
                <dd>
                  <AnimatedNumber value={verdict.startTotal} format={money} />
                </dd>
              </div>
              <div>
                <dt>Average yearly draw</dt>
                <dd>
                  <AnimatedNumber value={verdict.avgDrawToday} format={money} />
                </dd>
              </div>
              <div>
                <dt>Taxes over the plan</dt>
                <dd>
                  <AnimatedNumber value={verdict.taxesToday} format={money} />
                </dd>
              </div>
            </dl>

            <div className="vbg-story-whatif">
              <p className="vbg-story-subhead">What if&hellip;</p>
              <div className="vbg-story-lever">
                <label>
                  I spend{" "}
                  <strong>
                    <AnimatedNumber
                      value={scenario.annualSpend}
                      format={(n) => `${money(n)} a year`}
                    />
                  </strong>
                </label>
                <StorySlider
                  label="Annual spending"
                  min={20_000}
                  max={Math.max(300_000, niceCeil(scenario.annualSpend * 1.1))}
                  step={1_000}
                  value={scenario.annualSpend}
                  onChange={(annualSpend) =>
                    update((s) => ({ ...s, spendMode: "fixed", annualSpend }))
                  }
                />
              </div>
              {firstIncome ? (
                <div className="vbg-story-lever">
                  <label>
                    {firstIncome.label} starts at age{" "}
                    <strong>{firstIncome.startAge}</strong>
                  </label>
                  <StorySlider
                    label={`${firstIncome.label} start age`}
                    min={scenario.age}
                    max={scenario.endAge}
                    value={firstIncome.startAge}
                    onChange={(startAge) =>
                      update((s) => ({
                        ...s,
                        incomes: s.incomes.map((i) =>
                          i.id === firstIncome.id ? { ...i, startAge } : i,
                        ),
                      }))
                    }
                  />
                </div>
              ) : null}
              <div className="vbg-story-lever">
                <label>
                  I plan through age <strong>{scenario.endAge}</strong>
                </label>
                <StorySlider
                  label="Plan through age"
                  min={scenario.age + 1}
                  max={110}
                  value={scenario.endAge}
                  onChange={(endAge) => update((s) => ({ ...s, endAge }))}
                />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </SceneShell>
  );
}
