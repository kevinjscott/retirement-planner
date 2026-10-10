"use client";

import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultEventForKind,
  MajorEventsTable,
} from "@/components/MajorEventsTable";
import {
  DeferredNumberInput,
  formatWithCommas,
} from "@/components/DeferredNumberInput";
import { DrawOrderStatusHint } from "@/components/DrawOrderStatusHint";
import { InfoHint } from "@/components/InfoHint";
import { InteractiveChart } from "@/components/InteractiveChart";
import { LiquidFromPicker } from "@/components/LiquidFromPicker";
import { YearSliderPicker } from "@/components/YearSliderPicker";
import { ScenarioImport } from "@/components/ScenarioImport";
import { StoryFlow, type StoryMode } from "@/components/story/StoryFlow";
import { VoiceMode } from "@/components/voice/VoiceMode";
import { useScenarioHistory } from "@/hooks/useScenarioHistory";
import {
  buildExportPayload,
  buildInsights,
  compareDrawOrders,
  DRAW_ORDER_LABEL,
} from "@/lib/insights";
import {
  DEFAULT_SCENARIO,
  EVENT_KIND_LABEL,
  FUND_OPTIONS,
  KIND_LABEL,
  RMD_DEFAULT_AGE,
  buildTimelineMilestones,
  clampCostBasisPct,
  deflateToToday,
  fmtMoney,
  hasPretaxBalance,
  isCollegeEvent,
  type Account,
  type AccountKind,
  type FundPreset,
  type IncomeStream,
  type LifeEvent,
  type LifeEventKind,
  type PersonalMilestone,
  type ScenarioInput,
  type SpendMode,
  type WithdrawOrder,
  fmtPct,
  fundRate,
  migrateScenario,
  netWorthBreakdown,
  newAccount,
  project,
  uid,
  resolveFederalLtcgRate,
  resolveFederalRate,
} from "@/lib/projection";
import {
  US_STATES,
  combinedCapitalGainsRate,
  combinedPretaxRate,
  type UsStateCode,
} from "@/lib/us-taxes";

const STORAGE_KEY = "retirement-scenarios:v2";
const STORY_SKIPPED_KEY = "retirement-scenarios:story-skipped";

const panelVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 140, damping: 22 },
  },
};

const panelsVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};
const CALENDAR_START = new Date().getFullYear();

const DRAW_ORDER_HINT: Record<WithdrawOrder, string> = {
  "taxable-trad-roth":
    "Living spend: taxable → pretax (Trad IRA / 401k) → Roth. Pretax and taxable CG grossed up when Gross-up is on.",
  "taxable-roth-trad":
    "Living spend: taxable → Roth → pretax (Trad IRA / 401k). Pretax and taxable CG grossed up when Gross-up is on.",
  "pro-rata":
    "Living spend taken proportionally from each remaining balance.",
};

const TAX_ESTIMATE_HINT =
  "Ordinary federal from spend + income · LTCG 0/15/20 · single 2025 brackets";

const GROSS_UP_HINT =
  "Grosses up Trad/401(k) at ordinary rates and taxable brokerage at LTCG on the gain share (basis %). Roth, checking/cash, and qualified 529 education draws are not grossed up.";

const BASIS_HINT =
  "Share of taxable investment balances treated as cost basis (rest is unrealized gain subject to LTCG). Checking / money-market funds are always 100% basis. Default 50%.";

const RMD_HINT =
  "From age 73, the model withdraws at least the IRS Required Minimum Distribution from Trad/401(k) each year (prior year-end balance ÷ Uniform Lifetime Table factor). That amount funds lifestyle spend first; any leftover (after modeled tax) moves into taxable brokerage so the nest egg isn't destroyed — not tax advice.";

const TAXABLE_DRAW_HINT =
  "Withdrawals from taxable brokerage to fund living and unpaid event costs after income and 529s. When Gross-up is on, LTCG on the gain share is grossed up so net covers the spend need.";

const PRETAX_DRAW_HINT =
  "Withdrawals from Trad IRA / 401(k), including RMDs. When Gross-up is on, pretax draws are grossed up so net covers the spend gap; before 59½ a 10% early-withdrawal penalty is included.";

const ROTH_DRAW_HINT =
  "Withdrawals from Roth IRA / Roth 401(k) to fund living and unpaid event costs after income and 529s.";

const TAXES_HINT =
  "Estimated taxes paid via withdrawal gross-up — pretax ordinary income tax (plus 10% early-withdrawal penalty before 59½), taxable-brokerage LTCG (and WA state CG when applicable).";

const LIVING_SPEND_HINT =
  "Inflated lifestyle target each year — the flat-ish baseline. Draws rise above this for unpaid major expenses and tax gross-up.";

const EVENT_FROM_529_HINT =
  "Qualified 529 withdrawals applied to linked college-kind events this year. Reduces the event gap funded by taxable/pretax/Roth draws; not tax-grossed-up.";

const LIQUID_FROM_HINT =
  "Calendar year this balance can fund living spend. Blank = liquid now. Locked accounts are skipped in draw order until that year.";

const CASH_FLOWS_SUBTITLE =
  "Draws by account type after income/529s; Taxes is estimated gross-up. Pink bands = cash-flow pinch before unlock.";

function finePointerHover(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

/** Net assets total with hover/tap bucket breakdown (dense, dismissible). */
function NetAssetsSummary({
  total,
  buckets,
}: {
  total: number;
  buckets: ReturnType<typeof netWorthBreakdown>["buckets"];
}) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const visible = open || hovering;

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
    <div
      ref={rootRef}
      className={`vbg-custom-net-worth${visible ? " is-open" : ""}`}
      aria-live="polite"
      onMouseEnter={() => {
        if (finePointerHover()) setHovering(true);
      }}
      onMouseLeave={() => {
        if (finePointerHover()) setHovering(false);
      }}
    >
      <button
        type="button"
        className="vbg-custom-net-worth-total"
        aria-expanded={visible}
        aria-controls={tipId}
        aria-label="Net assets breakdown"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span>
          Net assets
          <span className="vbg-custom-net-worth-chevron" aria-hidden="true">
            ▾
          </span>
        </span>
        <span className="vbg-numeric">{fmtMoney(total)}</span>
      </button>
      {visible ? (
        <div
          id={tipId}
          className="vbg-custom-net-worth-popover"
          role="dialog"
          aria-label="Net assets by bucket"
        >
          {buckets.map((b) => (
            <div className="vbg-custom-net-worth-row" key={b.id}>
              <span>{b.label}</span>
              <span className="vbg-meta">
                {total > 0 ? `${Math.round((b.amount / total) * 100)}%` : "—"}
              </span>
              <span className="vbg-numeric">{fmtMoney(b.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** True when the guided setup has nothing to protect: no saved plan and no earlier skip. */
function isFirstVisit(): boolean {
  try {
    return (
      localStorage.getItem(STORAGE_KEY) == null &&
      localStorage.getItem("retirement-scenarios:v1") == null &&
      localStorage.getItem(STORY_SKIPPED_KEY) == null
    );
  } catch {
    return true;
  }
}

function loadScenario(): ScenarioInput {
  if (typeof window === "undefined") return DEFAULT_SCENARIO;
  try {
    const v2 = localStorage.getItem(STORAGE_KEY);
    if (v2) return migrateScenario(JSON.parse(v2));
    const v1 = localStorage.getItem("retirement-scenarios:v1");
    if (v1) return migrateScenario(JSON.parse(v1));
    return DEFAULT_SCENARIO;
  } catch {
    return DEFAULT_SCENARIO;
  }
}

function Field({
  id,
  label,
  children,
  helper,
  narrow,
  hint,
  info,
  voicePath,
}: {
  id: string;
  label: string;
  children: ReactNode;
  /** Long explanation — shown in a hover/tap popover (not always-visible) */
  helper?: string;
  narrow?: boolean;
  /** Short native title on the field shell (optional) */
  hint?: string;
  /** Alias for helper popover text */
  info?: string;
  voicePath?: string;
}) {
  const tip = info ?? helper;
  return (
    <div
      className={`vbg-field${narrow ? " vbg-custom-field-narrow" : ""}`}
      title={hint}
      data-voice-path={voicePath ?? id}
    >
      <div className="vbg-custom-label-row">
        <label className="vbg-label" htmlFor={id}>
          {label}
        </label>
        {tip ? <InfoHint text={tip} label={`About ${label}`} /> : null}
      </div>
      {children}
    </div>
  );
}

function UnitMoney({
  id,
  value,
  onChange,
  voicePath,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  voicePath?: string;
}) {
  return (
    <div className="vbg-unit-field vbg-custom-money" data-voice-path={voicePath}>
      <span className="vbg-unit-prefix">$</span>
      <DeferredNumberInput
        id={id}
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        format={formatWithCommas}
        data-voice-path={voicePath}
        onCommit={(n) => {
          if (n === null) return;
          onChange(Math.max(0, n));
        }}
      />
    </div>
  );
}

function UnitPct({
  id,
  value,
  onChange,
  voicePath,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  voicePath?: string;
}) {
  const pct = Number((value * 100).toFixed(2));
  return (
    <div className="vbg-unit-field vbg-custom-pct" data-voice-path={voicePath}>
      <DeferredNumberInput
        id={id}
        inputMode="decimal"
        value={pct}
        data-voice-path={voicePath}
        onCommit={(n) => {
          if (n === null) return;
          onChange(Math.max(0, Math.min(100, n)) / 100);
        }}
      />
      <span className="vbg-unit-suffix">%</span>
    </div>
  );
}

function UnitNumber({
  id,
  value,
  onChange,
  min,
  max,
  voicePath,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  voicePath?: string;
}) {
  return (
    <div className="vbg-unit-field vbg-custom-num" data-voice-path={voicePath}>
      <DeferredNumberInput
        id={id}
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        data-voice-path={voicePath}
        onCommit={(n) => {
          if (n === null) return;
          let next = Math.round(n);
          if (min !== undefined) next = Math.max(min, next);
          if (max !== undefined) next = Math.min(max, next);
          onChange(next);
        }}
      />
    </div>
  );
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type || "text";
    // Native field undo for text-like inputs; selects/checkboxes use app history.
    return !["button", "checkbox", "radio", "range", "file", "color", "submit", "reset"].includes(
      type,
    );
  }
  return false;
}

export function RetirementCalculator() {
  const { scenario, setScenario, undo, redo, canUndo, canRedo } =
    useScenarioHistory(DEFAULT_SCENARIO);
  const [hydrated, setHydrated] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [story, setStory] = useState<{ mode: StoryMode } | null>(null);
  const [introPending, setIntroPending] = useState(false);
  const [handoffNote, setHandoffNote] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const untouchedRef = useRef<string | null>(null);
  const resetTitleId = useId();
  const undoShortcut = isMacPlatform() ? "⌘Z" : "Ctrl+Z";
  const redoShortcut = isMacPlatform() ? "⌘⇧Z" : "Ctrl+Shift+Z";

  useEffect(() => {
    const firstVisit = isFirstVisit();
    setScenario(loadScenario(), { history: "replace" });
    if (firstVisit) {
      setStory({ mode: "first" });
      setIntroPending(true);
    }
    setHydrated(true);
  }, [setScenario]);

  useEffect(() => {
    if (!hydrated) return;
    // A first-time visitor hasn't chosen anything yet; don't save the example as theirs.
    if (story?.mode === "first") return;
    // Skipped the setup without changing anything: the example plan isn't theirs to save.
    if (untouchedRef.current === JSON.stringify(scenario)) return;
    const federalRate = resolveFederalRate(scenario);
    let failed = false;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...scenario, federalRate }),
      );
    } catch {
      failed = true;
    }
    const t = window.setTimeout(() => setSaveFailed(failed), 0);
    return () => window.clearTimeout(t);
  }, [scenario, hydrated, story]);

  useEffect(() => {
    if (!handoffNote) return;
    const t = window.setTimeout(() => setHandoffNote(false), 14000);
    return () => window.clearTimeout(t);
  }, [handoffNote]);

  useEffect(() => {
    if (!resetOpen) return;
    const body = document.body;
    body.classList.add("is-modal-open");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setResetOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      body.classList.remove("is-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [resetOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if (key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      // Windows / Linux Ctrl+Y redo (skip when Meta is held — Mac uses ⌘⇧Z).
      if (key === "y" && e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const confirmReset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("retirement-scenarios:v1");
      localStorage.removeItem(STORY_SKIPPED_KEY);
    } catch {
      setSaveFailed(true);
    }
    untouchedRef.current = JSON.stringify(DEFAULT_SCENARIO);
    setScenario(DEFAULT_SCENARIO, { history: "replace" });
    setResetOpen(false);
    setIntroPending(true);
    setStory({ mode: "first" });
  };

  const finishStory = (next: ScenarioInput) => {
    const mode = story?.mode;
    setScenario(next, { history: mode === "first" ? "replace" : "push" });
    setStory(null);
    setHandoffNote(true);
  };

  const skipStory = () => {
    const mode = story?.mode;
    setStory(null);
    if (mode === "first") {
      untouchedRef.current = JSON.stringify(scenario);
      try {
        localStorage.setItem(STORY_SKIPPED_KEY, "1");
      } catch {
        setSaveFailed(true);
      }
      setHandoffNote(true);
    }
  };

  const patch = (partial: Partial<ScenarioInput>) =>
    setScenario((s) => ({ ...s, ...partial }));

  const updateAccount = (id: string, partial: Partial<Account>) =>
    setScenario((s) => ({
      ...s,
      accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...partial } : a)),
    }));

  const updateIncome = (id: string, partial: Partial<IncomeStream>) =>
    setScenario((s) => ({
      ...s,
      incomes: s.incomes.map((i) => (i.id === id ? { ...i, ...partial } : i)),
    }));

  const updateEvent = (id: string, partial: Partial<LifeEvent>) =>
    setScenario((s) => ({
      ...s,
      events: s.events.map((e) => (e.id === id ? { ...e, ...partial } : e)),
    }));

  const addEvent = (kind: LifeEventKind) => {
    const id = uid("event");
    setScenario((s) => ({
      ...s,
      events: [...s.events, { id, ...defaultEventForKind(kind, s.events) }],
    }));
  };

  const link529ToEvent = (eventId: string, accountId: string | null) => {
    setScenario((s) => ({
      ...s,
      accounts: s.accounts.map((a) => {
        if (a.kind !== "529") return a;
        if (accountId == null) {
          return a.linkedEventId === eventId ? { ...a, linkedEventId: null } : a;
        }
        if (a.id === accountId) return { ...a, linkedEventId: eventId };
        if (a.linkedEventId === eventId) return { ...a, linkedEventId: null };
        return a;
      }),
    }));
  };

  const rows = useMemo(
    () => project(scenario, CALENDAR_START),
    [scenario],
  );
  const insights = useMemo(() => buildInsights(scenario, rows), [scenario, rows]);
  const drawOrderComparison = useMemo(
    () => compareDrawOrders(scenario),
    [scenario],
  );
  const timelineMilestones = useMemo(
    () => buildTimelineMilestones(scenario, rows, CALENDAR_START),
    [scenario, rows],
  );
  const balanceSeries = useMemo(() => {
    const nearlyPositive = (n: number) => Math.abs(n) >= 0.5;
    const hasIlliquid = (
      liquid: (r: (typeof rows)[number]) => number,
      total: (r: (typeof rows)[number]) => number,
    ) => rows.some((r) => nearlyPositive(total(r) - liquid(r)));

    type BalSeries = {
      key: string;
      label: string;
      colorClass: string;
      colorKey?: string;
      lineType?: "solid" | "dotted";
      get: (r: (typeof rows)[number]) => number;
    };

    const series: BalSeries[] = [];
    const pushBucket = (
      key: string,
      label: string,
      colorClass: string,
      liquidGet: (r: (typeof rows)[number]) => number,
      totalGet: (r: (typeof rows)[number]) => number,
    ) => {
      series.push({
        key,
        label,
        colorClass,
        get: liquidGet,
      });
      if (hasIlliquid(liquidGet, totalGet)) {
        series.push({
          key: `${key}Illiquid`,
          label: `${label} (illiquid)`,
          colorClass,
          colorKey: key,
          lineType: "dotted",
          get: (r) => Math.max(0, totalGet(r) - liquidGet(r)),
        });
      }
    };

    pushBucket(
      "taxable",
      "Taxable",
      "vbg-series-1",
      (r) => r.liquidTaxable,
      (r) => r.taxable,
    );
    pushBucket(
      "pretax",
      "Pretax",
      "vbg-series-2",
      (r) => r.liquidPretax,
      (r) => Math.max(0, r.retirement - r.roth),
    );
    pushBucket(
      "roth",
      "Roth",
      "vbg-series-roth",
      (r) => r.liquidRoth,
      (r) => r.roth,
    );
    pushBucket(
      "education",
      "529",
      "vbg-series-3",
      (r) => r.liquidEducation,
      (r) => r.education,
    );
    return series;
  }, [rows]);
  const horizon = Math.max(1, scenario.endAge - scenario.age);

  const updatePersonalMilestone = (
    id: string,
    partial: Partial<PersonalMilestone>,
  ) =>
    setScenario((s) => ({
      ...s,
      personalMilestones: s.personalMilestones.map((m) =>
        m.id === id ? { ...m, ...partial } : m,
      ),
    }));

  const addPersonalMilestone = () => {
    setScenario((s) => {
      const yearOffset = Math.min(
        Math.max(0, s.endAge - s.age),
        Math.round((s.endAge - s.age) / 3),
      );
      return {
        ...s,
        personalMilestones: [
          ...s.personalMilestones,
          {
            id: uid("milestone"),
            label: "Personal milestone",
            yearOffset,
          },
        ],
      };
    });
  };
  const depleted = rows.find((r) => r.total < 1 && r.year > 0);
  const endingInsight = insights.find((i) => i.id === "ending");
  const { total: netWorthTotal, buckets: netWorthBuckets } = netWorthBreakdown(
    scenario.accounts,
  );
  const taxBreakdown = combinedPretaxRate(
    resolveFederalRate(scenario),
    scenario.stateCode,
  );
  const cgBreakdown = combinedCapitalGainsRate(
    resolveFederalLtcgRate(scenario),
    scenario.stateCode,
  );
  const combinedTax = taxBreakdown.combined;
  const basisPct = clampCostBasisPct(scenario.taxableCostBasisPct);
  const showRmd = hasPretaxBalance(scenario.accounts);
  const firstRmdRow = showRmd ? rows.find((r) => r.rmd > 0) : undefined;
  const firstRmdToday = firstRmdRow
    ? deflateToToday(firstRmdRow.rmd, scenario.inflation, firstRmdRow.year)
    : 0;

  const copyExport = async () => {
    const payload = buildExportPayload(scenario, rows);
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setExportStatus("Copied JSON");
    } catch {
      setExportStatus("Copy failed");
    }
    window.setTimeout(() => setExportStatus(null), 2000);
  };

  // Don't paint DEFAULT_SCENARIO accounts/events/incomes before localStorage hydrate.
  if (!hydrated) {
    return (
      <div
        className="vbg-custom-screen"
        aria-busy="true"
        aria-label="Loading saved scenario"
      >
        <header className="vbg-header vbg-custom-header">
          <div className="vbg-masthead">
            <div className="vbg-identity">
              <h1 className="vbg-heading-16">Retirement scenarios</h1>
            </div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <>
    <div className="vbg-custom-screen" inert={story ? true : undefined}>
      <header className="vbg-header vbg-custom-header">
        <div className="vbg-masthead">
          <div className="vbg-identity">
            <h1 className="vbg-heading-16">Retirement scenarios</h1>
          </div>
          <div className="vbg-document-meta">
            <button
              type="button"
              className="vbg-button"
              data-variant="ghost"
              title={`Undo (${undoShortcut})`}
              aria-label={`Undo (${undoShortcut})`}
              disabled={!canUndo}
              onClick={undo}
            >
              Undo
            </button>
            <button
              type="button"
              className="vbg-button"
              data-variant="ghost"
              title={`Redo (${redoShortcut})`}
              aria-label={`Redo (${redoShortcut})`}
              disabled={!canRedo}
              onClick={redo}
            >
              Redo
            </button>
            <button
              type="button"
              className="vbg-button"
              data-variant="secondary"
              title="Copies assumptions, results, and year-by-year rows for another LLM"
              onClick={() => void copyExport()}
            >
              {exportStatus ?? "Copy JSON"}
            </button>
            <button
              type="button"
              className="vbg-button"
              data-variant="secondary"
              title="Walk through your plan one question at a time"
              onClick={() => setStory({ mode: "replay" })}
            >
              Guided setup
            </button>
            <ScenarioImport
              scenario={scenario}
              onApply={(next) => setScenario(next, { history: "replace" })}
            />
            <VoiceMode
              scenario={scenario}
              onScenarioChange={setScenario}
            />
            <button
              type="button"
              className="vbg-button"
              data-variant="ghost"
              title="Clear saved scenario and restore defaults"
              onClick={() => setResetOpen(true)}
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      {saveFailed ? (
        <p className="vbg-meta vbg-custom-save-warning" role="status">
          Couldn&apos;t save to this browser (storage may be blocked or full), so
          your changes won&apos;t be kept after you close the tab. Use Copy JSON
          to keep a copy.
        </p>
      ) : null}

      {resetOpen ? (
        <div className="vbg-custom-import-dialog-root">
          <button
            type="button"
            className="vbg-custom-popover-scrim"
            aria-label="Cancel reset"
            onClick={() => setResetOpen(false)}
          />
          <div
            className="vbg-custom-import-dialog vbg-custom-reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={resetTitleId}
          >
            <div className="vbg-custom-import-dialog-head">
              <h2 id={resetTitleId} className="vbg-heading-16">
                Reset scenario?
              </h2>
              <p className="vbg-meta">
                Clears saved data and restarts the guided setup.
              </p>
            </div>
            <div className="vbg-custom-popover-actions">
              <button
                type="button"
                className="vbg-button"
                data-variant="ghost"
                onClick={() => setResetOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vbg-button"
                data-variant="secondary"
                onClick={confirmReset}
              >
                Confirm reset
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <motion.div
        className="vbg-calculator vbg-custom-calc"
        data-layout="split"
        variants={panelsVariants}
        initial={introPending ? "hidden" : false}
        animate={introPending && story ? "hidden" : "shown"}
      >
        <motion.div
          className="vbg-result"
          data-priority="primary"
          variants={panelVariants}
        >
          <p className="vbg-result-label">
            {depleted
              ? "Funds run out"
              : (endingInsight?.label ?? "Ending nest egg in today's $")}
          </p>
          <p className="vbg-result-value">
            {depleted
              ? `Age ${scenario.age + depleted.year}`
              : (endingInsight?.value ?? "—")}
          </p>
          <p className="vbg-result-detail">
            {depleted
              ? `${depleted.year} of ${horizon} planned years`
              : (endingInsight?.detail ?? "")}
          </p>
        </motion.div>

        <motion.div className="vbg-calculator-inputs" variants={panelVariants}>
          <div className="vbg-custom-dense">
            <Field id="age" label="Age now" narrow voicePath="age">
              <UnitNumber
                id="age"
                value={scenario.age}
                min={30}
                max={90}
                voicePath="age"
                onChange={(age) => patch({ age })}
              />
            </Field>
            <Field id="endAge" label="To age" narrow voicePath="endAge">
              <UnitNumber
                id="endAge"
                value={scenario.endAge}
                min={scenario.age + 1}
                max={110}
                voicePath="endAge"
                onChange={(endAge) => patch({ endAge })}
              />
            </Field>
            <Field id="inflation" label="Inflation" narrow voicePath="inflation">
              <UnitPct
                id="inflation"
                value={scenario.inflation}
                voicePath="inflation"
                onChange={(inflation) => patch({ inflation })}
              />
            </Field>
            <Field id="state" label="State" narrow voicePath="stateCode">
              <select
                id="state"
                className="vbg-custom-input-state"
                data-voice-path="stateCode"
                value={scenario.stateCode}
                onChange={(e) => patch({ stateCode: e.target.value as UsStateCode })}
              >
                {US_STATES.map((st) => (
                  <option key={st.code} value={st.code}>
                    {st.code}
                    {st.ordinaryRate === 0 || !st.taxesRetirementDistributions
                      ? " · 0%"
                      : ` · ${fmtPct(st.ordinaryRate)}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="spendMode" label="Spending" narrow voicePath="spendMode">
              <select
                id="spendMode"
                className="vbg-custom-input-spend"
                data-voice-path="spendMode"
                value={scenario.spendMode}
                onChange={(e) => patch({ spendMode: e.target.value as SpendMode })}
              >
                <option value="fixed">Fixed $</option>
                <option value="percent">% of start</option>
              </select>
            </Field>
            {scenario.spendMode === "fixed" ? (
              <Field
                id="annualSpend"
                label="Annual spend (today's $)"
                hint="Grows with inflation"
                narrow
                voicePath="annualSpend"
              >
                <UnitMoney
                  id="annualSpend"
                  value={scenario.annualSpend}
                  voicePath="annualSpend"
                  onChange={(annualSpend) => patch({ annualSpend })}
                />
              </Field>
            ) : (
              <Field
                id="withdrawPct"
                label="Initial %"
                hint="First-year $ grows with inflation"
                narrow
                voicePath="withdrawPct"
              >
                <UnitPct
                  id="withdrawPct"
                  value={scenario.withdrawPct}
                  voicePath="withdrawPct"
                  onChange={(withdrawPct) => patch({ withdrawPct })}
                />
              </Field>
            )}
            <Field
              id="order"
              label="Draw order"
              info={DRAW_ORDER_HINT[scenario.order]}
              narrow
              voicePath="order"
            >
              <div className="vbg-custom-order-control" data-voice-path="order">
                <select
                  id="order"
                  className="vbg-custom-input-order"
                  data-voice-path="order"
                  value={scenario.order}
                  onChange={(e) =>
                    patch({ order: e.target.value as WithdrawOrder })
                  }
                >
                  <option value="taxable-trad-roth">
                    {DRAW_ORDER_LABEL["taxable-trad-roth"]}
                  </option>
                  <option value="taxable-roth-trad">
                    {DRAW_ORDER_LABEL["taxable-roth-trad"]}
                  </option>
                  <option value="pro-rata">
                    {DRAW_ORDER_LABEL["pro-rata"]}
                  </option>
                </select>
                <DrawOrderStatusHint
                  comparison={drawOrderComparison}
                  currentOrder={scenario.order}
                  onUseBest={() =>
                    patch({ order: drawOrderComparison.best.order })
                  }
                />
              </div>
            </Field>
            <div className="vbg-custom-dense-tax">
              <div className="vbg-custom-bracket">
                <div className="vbg-custom-label-row">
                  <p className="vbg-label">Tax</p>
                  <InfoHint text={TAX_ESTIMATE_HINT} label="About tax estimate" />
                </div>
                <p className="vbg-meta vbg-custom-tax-meta">
                  Pretax ~{fmtPct(taxBreakdown.federal)}
                  {taxBreakdown.state > 0
                    ? ` + ${scenario.stateCode} ${fmtPct(taxBreakdown.state)} → ${fmtPct(combinedTax)}`
                    : ` · ${scenario.stateCode} 0% → ${fmtPct(combinedTax)}`}
                </p>
                <p className="vbg-meta vbg-custom-tax-meta">
                  LTCG ~{fmtPct(cgBreakdown.federal)}
                  {cgBreakdown.state > 0
                    ? ` + ${scenario.stateCode} CG ${fmtPct(cgBreakdown.state)} → ${fmtPct(cgBreakdown.combined)} on gains`
                    : ` · ${scenario.stateCode} 0% → ${fmtPct(cgBreakdown.combined)} on gains`}
                </p>
              </div>
              <div className="vbg-custom-check-with-info" data-voice-path="modelTaxes">
                <label className="vbg-custom-check">
                  <input
                    type="checkbox"
                    data-voice-path="modelTaxes"
                    checked={scenario.modelTaxes}
                    onChange={(e) => patch({ modelTaxes: e.target.checked })}
                  />
                  <span>Gross-up</span>
                </label>
                <InfoHint text={GROSS_UP_HINT} label="About gross-up" />
              </div>
              <Field
                id="taxableCostBasisPct"
                label="Taxable basis"
                narrow
                info={BASIS_HINT}
                voicePath="taxableCostBasisPct"
              >
                <UnitPct
                  id="taxableCostBasisPct"
                  value={basisPct}
                  voicePath="taxableCostBasisPct"
                  onChange={(taxableCostBasisPct) =>
                    patch({
                      taxableCostBasisPct: clampCostBasisPct(taxableCostBasisPct),
                    })
                  }
                />
              </Field>
              {showRmd ? (
                <div className="vbg-custom-bracket vbg-custom-rmd-meta">
                  <div className="vbg-custom-label-row">
                    <p className="vbg-label">RMDs</p>
                    <InfoHint text={RMD_HINT} label="About RMDs" />
                  </div>
                  <p className="vbg-meta vbg-custom-tax-meta">
                    From age {RMD_DEFAULT_AGE}
                    {firstRmdToday > 0
                      ? ` · first year ~${fmtMoney(firstRmdToday, true)} (today's $) from pretax`
                      : " · Trad/401(k) required withdrawals"}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="vbg-control-group">
            <div className="vbg-custom-section-head">
              <div>
                <p className="vbg-label">Current Holdings</p>
                <p className="vbg-meta">Today&apos;s $</p>
              </div>
              <div className="vbg-custom-inline-actions">
                {(
                  [
                    ["taxable", "Taxable"],
                    ["roth", "Roth"],
                    ["traditional", "Trad"],
                    ["401k", "401k"],
                    ["529", "529"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="vbg-button"
                    data-variant="secondary"
                    onClick={() =>
                      setScenario((s) => ({
                        ...s,
                        accounts: [...s.accounts, newAccount(kind, s)],
                      }))
                    }
                  >
                    + {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="vbg-custom-wealth-head" aria-hidden="true">
              <span>Type</span>
              <span>Name</span>
              <span>Balance</span>
              <span className="wealth-head-liquid">
                Liquid from
                <InfoHint text={LIQUID_FROM_HINT} label="About liquid from" />
              </span>
              <span>Fund</span>
              <span>Rate</span>
              <span />
            </div>
            <div className="vbg-custom-wealth-rows">
              {scenario.accounts.map((acct) => (
                <div
                  className="vbg-custom-wealth-row"
                  key={acct.id}
                  data-voice-path={`accounts.${acct.id}`}
                >
                  <select
                    aria-label="Type"
                    className="wealth-row-select"
                    data-voice-path={`accounts.${acct.id}.kind`}
                    value={acct.kind}
                    onChange={(e) => {
                      const kind = e.target.value as AccountKind;
                      updateAccount(acct.id, {
                        kind,
                        label:
                          acct.label === KIND_LABEL[acct.kind]
                            ? KIND_LABEL[kind]
                            : acct.label,
                        linkedEventId:
                          kind === "529"
                            ? acct.linkedEventId ??
                              scenario.events.find((e) => isCollegeEvent(e))?.id ??
                              scenario.events[0]?.id ??
                              null
                            : null,
                      });
                    }}
                  >
                    {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Name"
                    className="wealth-row-input"
                    data-voice-path={`accounts.${acct.id}.label`}
                    value={acct.label}
                    placeholder="Name"
                    onChange={(e) => updateAccount(acct.id, { label: e.target.value })}
                  />
                  <div
                    className="vbg-unit-field wealth-row-money"
                    data-voice-path={`accounts.${acct.id}.balance`}
                  >
                    <span className="vbg-unit-prefix">$</span>
                    <DeferredNumberInput
                      aria-label="Balance"
                      inputMode="numeric"
                      data-voice-path={`accounts.${acct.id}.balance`}
                      value={acct.balance}
                      format={formatWithCommas}
                      onCommit={(n) => {
                        if (n === null) return;
                        updateAccount(acct.id, { balance: Math.max(0, n) });
                      }}
                    />
                  </div>
                  <LiquidFromPicker
                    value={acct.liquidFromYear}
                    startYear={CALENDAR_START}
                    horizon={horizon}
                    accountLabel={acct.label}
                    voicePath={`accounts.${acct.id}.liquidFromYear`}
                    onChange={(liquidFromYear) =>
                      updateAccount(acct.id, { liquidFromYear })
                    }
                  />
                  <select
                    aria-label="Fund"
                    className="wealth-row-select"
                    data-voice-path={`accounts.${acct.id}.fund`}
                    value={acct.fund}
                    onChange={(e) => {
                      const fund = e.target.value as FundPreset;
                      updateAccount(acct.id, {
                        fund,
                        customReturn:
                          fund === "custom"
                            ? acct.customReturn
                            : fundRate(fund, acct.customReturn),
                      });
                    }}
                  >
                    {FUND_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {acct.fund === "custom" ? (
                    <UnitPct
                      id={`${acct.id}-custom`}
                      value={acct.customReturn}
                      voicePath={`accounts.${acct.id}.customReturn`}
                      onChange={(customReturn) => updateAccount(acct.id, { customReturn })}
                    />
                  ) : (
                    <span
                      className="vbg-meta vbg-custom-rate-readout"
                      data-voice-path={`accounts.${acct.id}.fund`}
                    >
                      {fmtPct(fundRate(acct.fund, acct.customReturn))}
                    </span>
                  )}
                  <button
                    type="button"
                    className="wealth-row-remove"
                    aria-label="Remove account"
                    data-voice-path={`accounts.${acct.id}`}
                    onClick={() =>
                      setScenario((s) => ({
                        ...s,
                        accounts: s.accounts.filter((a) => a.id !== acct.id),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <NetAssetsSummary total={netWorthTotal} buckets={netWorthBuckets} />
          </div>

          <div className="vbg-control-group">
            <div className="vbg-custom-section-head">
              <div>
                <p className="vbg-label">Major expenses</p>
                <p className="vbg-meta">Cost/yr in today&apos;s $ · grows with inflation</p>
              </div>
              <div className="vbg-custom-inline-actions">
                {(Object.keys(EVENT_KIND_LABEL) as LifeEventKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="vbg-button"
                    data-variant="secondary"
                    onClick={() => addEvent(kind)}
                  >
                    + {EVENT_KIND_LABEL[kind]}
                  </button>
                ))}
              </div>
            </div>
            <MajorEventsTable
              events={scenario.events}
              accounts={scenario.accounts}
              horizon={horizon}
              currentAge={scenario.age}
              calendarStartYear={CALENDAR_START}
              onChange={updateEvent}
              onLink529={link529ToEvent}
              onRemove={(id) => {
                setScenario((s) => ({
                  ...s,
                  events: s.events.filter((e) => e.id !== id),
                  accounts: s.accounts.map((a) =>
                    a.linkedEventId === id ? { ...a, linkedEventId: null } : a,
                  ),
                }));
              }}
            />
          </div>

          <div className="vbg-control-group">
            <div className="vbg-custom-section-head">
              <div>
                <p className="vbg-label">Retirement income (today&apos;s $)</p>
                <p className="vbg-meta">Check Inflates to grow with inflation</p>
              </div>
              <div className="vbg-custom-inline-actions">
                <button
                  type="button"
                  className="vbg-button"
                  data-variant="secondary"
                  onClick={() =>
                    setScenario((s) => ({
                      ...s,
                      incomes: [
                        ...s.incomes,
                        {
                          id: uid("income"),
                          label: "Pension",
                          annualAmount: 24_000,
                          startAge: Math.min(s.age + 5, s.endAge),
                          endAge: null,
                          inflates: true,
                        },
                      ],
                    }))
                  }
                >
                  + Income
                </button>
              </div>
            </div>
            <div className="vbg-custom-income-rows">
              {scenario.incomes.map((inc) => (
                <div
                  className="vbg-custom-income-row"
                  key={inc.id}
                  data-voice-path={`incomes.${inc.id}`}
                >
                  <input
                    aria-label="Retirement income name"
                    data-voice-path={`incomes.${inc.id}.label`}
                    value={inc.label}
                    onChange={(e) => updateIncome(inc.id, { label: e.target.value })}
                  />
                  <UnitMoney
                    id={`${inc.id}-amt`}
                    value={inc.annualAmount}
                    voicePath={`incomes.${inc.id}.annualAmount`}
                    onChange={(annualAmount) => updateIncome(inc.id, { annualAmount })}
                  />
                  <YearSliderPicker
                    value={CALENDAR_START + (inc.startAge - scenario.age)}
                    min={CALENDAR_START}
                    max={CALENDAR_START + (scenario.endAge - scenario.age)}
                    ariaLabel="Income start year"
                    dialogLabel="Choose income start year"
                    sliderLabel="Start year"
                    voicePath={`incomes.${inc.id}.startAge`}
                    onChange={(cal) => {
                      if (cal === null) return;
                      const startAge = Math.max(
                        scenario.age,
                        Math.min(
                          scenario.endAge,
                          scenario.age + Math.round(cal) - CALENDAR_START,
                        ),
                      );
                      updateIncome(inc.id, {
                        startAge,
                        endAge:
                          inc.endAge != null && inc.endAge < startAge
                            ? startAge
                            : inc.endAge,
                      });
                    }}
                  />
                  <YearSliderPicker
                    value={
                      inc.endAge == null
                        ? null
                        : CALENDAR_START + (inc.endAge - scenario.age)
                    }
                    min={CALENDAR_START + (inc.startAge - scenario.age)}
                    max={CALENDAR_START + (scenario.endAge - scenario.age)}
                    allowNull
                    nullSliderMode="button"
                    nullLabel="∞"
                    showNullButton
                    ariaLabel="Income end year"
                    dialogLabel="Choose income end year"
                    sliderLabel="End year"
                    voicePath={`incomes.${inc.id}.endAge`}
                    onChange={(cal) => {
                      if (cal === null) {
                        updateIncome(inc.id, { endAge: null });
                        return;
                      }
                      updateIncome(inc.id, {
                        endAge: Math.max(
                          inc.startAge,
                          Math.min(
                            scenario.endAge,
                            scenario.age + Math.round(cal) - CALENDAR_START,
                          ),
                        ),
                      });
                    }}
                  />
                  <label
                    className="vbg-custom-check"
                    data-voice-path={`incomes.${inc.id}.inflates`}
                  >
                    <input
                      type="checkbox"
                      data-voice-path={`incomes.${inc.id}.inflates`}
                      checked={inc.inflates}
                      onChange={(e) => updateIncome(inc.id, { inflates: e.target.checked })}
                    />
                    <span>Inflates</span>
                  </label>
                  <button
                    type="button"
                    className="wealth-row-remove"
                    aria-label={`Remove ${inc.label || "income"}`}
                    data-voice-path={`incomes.${inc.id}`}
                    onClick={() =>
                      setScenario((s) => ({
                        ...s,
                        incomes: s.incomes.filter((i) => i.id !== inc.id),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

        </motion.div>

        <motion.div className="vbg-calculator-output" variants={panelVariants}>
          <div className="vbg-custom-insights">
            {insights
              .filter((insight) => insight.id !== "ending")
              .map((insight) => (
              <div
                key={insight.id}
                className={`vbg-custom-insight is-${insight.tone ?? "neutral"}`}
              >
                <p className="vbg-stat-label">{insight.label}</p>
                <p className="vbg-custom-insight-value">{insight.value}</p>
                {insight.detail ? <p className="vbg-meta">{insight.detail}</p> : null}
              </div>
            ))}
          </div>

          <InteractiveChart
            title="Balances (today's $)"
            rows={rows}
            inflation={scenario.inflation}
            calendarStartYear={CALENDAR_START}
            pretaxUnlockAge={
              timelineMilestones.find((m) => m.id === "life-59-5")?.age
            }
            series={balanceSeries}
          />
          <InteractiveChart
            title="Cash flows (today's $)"
            subtitle={CASH_FLOWS_SUBTITLE}
            rows={rows}
            inflation={scenario.inflation}
            calendarStartYear={CALENDAR_START}
            milestones={timelineMilestones}
            personalMilestones={scenario.personalMilestones}
            currentAge={scenario.age}
            endAge={scenario.endAge}
            showDrawBreakdown
            tall
            onAddPersonal={addPersonalMilestone}
            onChangePersonal={updatePersonalMilestone}
            onRemovePersonal={(id) =>
              setScenario((s) => ({
                ...s,
                personalMilestones: s.personalMilestones.filter(
                  (m) => m.id !== id,
                ),
              }))
            }
            series={[
              {
                key: "living",
                label: "Living spend",
                colorClass: "vbg-series-living",
                hint: LIVING_SPEND_HINT,
                get: (r) => r.living,
              },
              {
                key: "withdrawnTaxable",
                label: "Draw from taxable accounts",
                hint: TAXABLE_DRAW_HINT,
                get: (r) => r.withdrawnTaxable,
              },
              {
                key: "withdrawnPretax",
                label: "Draw from pretax accounts",
                hint: PRETAX_DRAW_HINT,
                get: (r) => r.withdrawnPretax,
              },
              {
                key: "withdrawnRoth",
                label: "Draw from Roth accounts",
                hint: ROTH_DRAW_HINT,
                get: (r) => r.withdrawnRoth,
              },
              {
                key: "taxes",
                label: "Taxes",
                hint: TAXES_HINT,
                get: (r) => r.taxes,
              },
              {
                key: "rmd",
                label: "RMD",
                colorClass: "vbg-series-rmd",
                get: (r) => r.rmd,
              },
              {
                key: "eventFrom529",
                label: "Draw from 529 accounts",
                hint: EVENT_FROM_529_HINT,
                get: (r) => r.eventFrom529,
              },
              {
                key: "events",
                label: "Expenses",
                colorClass: "vbg-series-5",
                get: (r) => r.eventCost,
              },
              {
                key: "income",
                label: "Retirement income",
                colorClass: "vbg-series-6",
                get: (r) => r.income,
              },
            ]}
          />
        </motion.div>
      </motion.div>
    </div>

    <AnimatePresence>
      {story ? (
        <StoryFlow
          key="story"
          mode={story.mode}
          initialScenario={story.mode === "first" ? DEFAULT_SCENARIO : scenario}
          importSlot={({ scenario: base, adopt }) => (
            <ScenarioImport
              scenario={base}
              onApply={adopt}
              renderTrigger={(open) => (
                <button type="button" className="vbg-story-link" onClick={open}>
                  Import from notes or a statement
                </button>
              )}
            />
          )}
          onFinish={finishStory}
          onSkip={skipStory}
        />
      ) : null}
    </AnimatePresence>

    <AnimatePresence>
      {handoffNote && !story ? (
        <motion.aside
          key="note"
          className="vbg-custom-handoff"
          role="status"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 220, damping: 24, delay: 0.7 }}
        >
          <p>
            <strong>Your plan is live.</strong> Every answer is an editable field
            here{saveFailed ? "." : ", and everything is saved in this browser."}
          </p>
          <div className="vbg-custom-handoff-actions">
            <button
              type="button"
              className="vbg-button"
              data-variant="secondary"
              onClick={() => {
                setHandoffNote(false);
                setStory({ mode: "replay" });
              }}
            >
              Replay guided setup
            </button>
            <button
              type="button"
              className="vbg-button"
              data-variant="ghost"
              onClick={() => setHandoffNote(false)}
            >
              Dismiss
            </button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
    </>
  );
}
