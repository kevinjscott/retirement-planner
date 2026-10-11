"use client";

import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Variants,
} from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CostsScene,
  IncomeScene,
  ResultScene,
  SavingsScene,
  SpendScene,
  WelcomeScene,
  YouScene,
} from "@/components/story/Scenes";
import { Stage, type SceneId } from "@/components/story/Stage";
import { EASE_OUT, SPRING_SNAPPY } from "@/components/story/primitives";
import {
  DEFAULT_SCENARIO,
  project,
  type ScenarioInput,
} from "@/lib/projection";
import {
  BLANK_START_SCENARIO,
  buildVerdict,
  buildYearBars,
  finalizeStoryScenario,
  normalizeTimeline,
  potBalance,
  type Pot,
} from "@/lib/story";
import { trapTab } from "@/lib/focus-trap";
import "@/components/story/story.css";

export type StoryMode = "first" | "replay";

const CALENDAR_START = new Date().getFullYear();

const CHAPTERS: { id: SceneId; label: string }[] = [
  { id: "you", label: "You" },
  { id: "spend", label: "Lifestyle" },
  { id: "savings", label: "Savings" },
  { id: "income", label: "Income" },
  { id: "costs", label: "Big costs" },
  { id: "result", label: "Result" },
];

const SCENE_ORDER: SceneId[] = [
  "welcome",
  ...CHAPTERS.map((c) => c.id),
];

const sceneVariants: Variants = {
  enter: (dir: number) => ({
    opacity: 0,
    x: dir * 36,
    filter: "blur(6px)",
  }),
  center: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: { duration: 0.45, ease: EASE_OUT },
  },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir * -36,
    filter: "blur(6px)",
    transition: { duration: 0.2, ease: "easeIn" },
  }),
};

const CONTINUE_LABEL: Partial<Record<SceneId, string>> = {
  you: "Continue to lifestyle",
  spend: "Continue to savings",
  savings: "Continue to income",
  income: "Continue to big costs",
  costs: "See my result",
};

export function StoryFlow({
  mode,
  initialScenario,
  importSlot,
  onFinish,
  onSkip,
}: {
  mode: StoryMode;
  initialScenario: ScenarioInput;
  /** Rendered on the welcome scene; receives the story's draft and a way to adopt an import. */
  importSlot: (api: {
    scenario: ScenarioInput;
    adopt: (next: ScenarioInput) => void;
  }) => ReactNode;
  onFinish: (scenario: ScenarioInput) => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState<ScenarioInput>(() =>
    normalizeTimeline(initialScenario),
  );
  const [sceneIndex, setSceneIndex] = useState(mode === "first" ? 0 : 1);
  const [dir, setDir] = useState(1);
  const [imported, setImported] = useState(false);
  const [hoverEra, setHoverEra] = useState<string | null>(null);
  const [activePot, setActivePot] = useState<Pot | null>(null);
  const [played, setPlayed] = useState(false);
  const copyRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const scene = SCENE_ORDER[sceneIndex]!;

  const rows = useMemo(() => project(draft, CALENDAR_START), [draft]);
  const bars = useMemo(() => buildYearBars(draft, rows), [draft, rows]);
  const verdict = useMemo(() => buildVerdict(draft, rows), [draft, rows]);
  const exampleRows = useMemo(() => project(DEFAULT_SCENARIO, CALENDAR_START), []);

  const update = useCallback(
    (fn: (s: ScenarioInput) => ScenarioInput) => setDraft((s) => fn(s)),
    [],
  );

  const goTo = useCallback((next: number) => {
    setSceneIndex((cur) => {
      const clamped = Math.max(0, Math.min(SCENE_ORDER.length - 1, next));
      setDir(clamped >= cur ? 1 : -1);
      return clamped;
    });
    setHoverEra(null);
    setActivePot(null);
    setPlayed(false);
  }, []);

  const canContinue =
    scene !== "savings" ||
    (["taxable", "pretax", "roth", "education"] as const).some(
      (p) => potBalance(draft, p) > 0,
    );

  const next = useCallback(() => {
    if (scene === "result") {
      onFinish(finalizeStoryScenario(draft));
      return;
    }
    if (!canContinue) return;
    goTo(sceneIndex + 1);
  }, [scene, canContinue, draft, goTo, onFinish, sceneIndex]);

  useEffect(() => {
    const el = copyRef.current?.querySelector<HTMLElement>("[data-story-title]");
    const t = window.setTimeout(() => el?.focus({ preventScroll: true }), 350);
    copyRef.current?.scrollTo({ top: 0 });
    return () => window.clearTimeout(t);
  }, [scene]);

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (e.key === "Tab") {
        if (t?.closest(".vbg-custom-import-dialog-root")) return;
        if (dialogRef.current) trapTab(e, dialogRef.current);
        return;
      }
      if (e.key === "Escape" && mode === "replay") {
        if (t?.closest(".vbg-custom-import-dialog-root")) return;
        onSkip();
        return;
      }
      if (e.key !== "Enter" || e.defaultPrevented) return;
      if (!t) return;
      if (t.closest("input, select, textarea, button, a, [role=radio]")) return;
      if (scene === "welcome") return;
      e.preventDefault();
      next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, next, onSkip, scene]);

  useEffect(() => {
    const body = document.body;
    body.classList.add("is-modal-open");
    return () => body.classList.remove("is-modal-open");
  }, []);

  const chapterIndex = sceneIndex - 1;
  const showNav = scene !== "welcome";

  const sceneProps = { scenario: draft, update, bars, rows, verdict };

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        className="vbg-story"
        role="dialog"
        aria-modal="true"
        aria-label="Guided setup"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{
          opacity: 0,
          scale: 1.025,
          filter: "blur(10px)",
          transition: { duration: 0.55, ease: EASE_OUT },
        }}
        transition={{ duration: 0.5 }}
      >
        <header className="vbg-story-top">
          <span className="vbg-story-brand">Retirement scenarios</span>
          <nav className="vbg-story-chapters" aria-label="Progress">
            <AnimatePresence initial={false}>
              {showNav
                ? CHAPTERS.map((c, i) => {
                    const done = i < chapterIndex;
                    const current = i === chapterIndex;
                    return (
                      <motion.button
                        key={c.id}
                        type="button"
                        className="vbg-story-chapter"
                        data-state={current ? "current" : done ? "done" : "todo"}
                        aria-current={current ? "step" : undefined}
                        disabled={!done}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: i * 0.05, duration: 0.4, ease: EASE_OUT }}
                        onClick={() => goTo(i + 1)}
                      >
                        <span className="vbg-story-chapter-bar">
                          <motion.span
                            className="vbg-story-chapter-fill"
                            initial={false}
                            animate={{ scaleX: done || current ? 1 : 0 }}
                            transition={{ duration: 0.6, ease: EASE_OUT }}
                          />
                        </span>
                        <span className="vbg-story-chapter-label">{c.label}</span>
                      </motion.button>
                    );
                  })
                : null}
            </AnimatePresence>
          </nav>
          <button
            type="button"
            className="vbg-story-link"
            onClick={onSkip}
          >
            {mode === "replay" ? "Close" : "Skip to planner"}
          </button>
        </header>

        <div className="vbg-story-body">
          <section className="vbg-story-copy" ref={copyRef}>
            <div className="vbg-story-copy-inner" data-welcome={scene === "welcome"}>
              <AnimatePresence mode="wait" custom={dir} initial={false}>
                <motion.div
                  key={scene}
                  custom={dir}
                  variants={sceneVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {scene === "welcome" ? (
                    <WelcomeScene
                      onBuild={() => {
                        setDraft(BLANK_START_SCENARIO);
                        setImported(false);
                        goTo(1);
                      }}
                      onExample={() => {
                        setDraft(DEFAULT_SCENARIO);
                        setImported(false);
                        goTo(1);
                      }}
                      onSkip={onSkip}
                      importSlot={importSlot({
                        scenario: mode === "replay" ? draft : BLANK_START_SCENARIO,
                        adopt: (n) => {
                          setDraft(normalizeTimeline(n));
                          setImported(true);
                          goTo(1);
                        },
                      })}
                    />
                  ) : null}
                  {scene === "you" ? (
                    <YouScene
                      {...sceneProps}
                      imported={imported}
                      onHoverEra={setHoverEra}
                    />
                  ) : null}
                  {scene === "spend" ? (
                    <SpendScene {...sceneProps} calendarStartYear={CALENDAR_START} />
                  ) : null}
                  {scene === "savings" ? (
                    <SavingsScene {...sceneProps} onActivePot={setActivePot} />
                  ) : null}
                  {scene === "income" ? <IncomeScene {...sceneProps} /> : null}
                  {scene === "costs" ? <CostsScene {...sceneProps} /> : null}
                  {scene === "result" ? (
                    <ResultScene {...sceneProps} played={played} />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {showNav ? (
                <motion.footer
                  className="vbg-story-nav"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={{ duration: 0.4, ease: EASE_OUT }}
                >
                  <button
                    type="button"
                    className="vbg-button"
                    data-variant="tertiary"
                    disabled={sceneIndex <= 1}
                    onClick={() => goTo(sceneIndex - 1)}
                  >
                    ← Back
                  </button>
                  <motion.button
                    type="button"
                    className="vbg-button vbg-story-cta"
                    data-variant="primary"
                    disabled={!canContinue || (scene === "result" && !played)}
                    whileTap={{ scale: 0.97 }}
                    transition={SPRING_SNAPPY}
                    onClick={next}
                  >
                    {scene === "result"
                      ? mode === "replay"
                        ? "Apply to my planner"
                        : "Open my planner"
                      : (CONTINUE_LABEL[scene] ?? "Continue")}
                    <span aria-hidden="true">→</span>
                  </motion.button>
                </motion.footer>
              ) : null}
            </AnimatePresence>
          </section>

          <section className="vbg-story-stage-col">
            <Stage
              scene={scene}
              scenario={draft}
              rows={rows}
              bars={bars}
              verdict={verdict}
              exampleRows={exampleRows}
              exampleStartAge={DEFAULT_SCENARIO.age}
              exampleEndAge={DEFAULT_SCENARIO.endAge}
              exampleInflation={DEFAULT_SCENARIO.inflation}
              hoverEra={hoverEra}
              activePot={activePot}
              calendarStartYear={CALENDAR_START}
              onCurveDone={() => setPlayed(true)}
            />
          </section>
        </div>
      </motion.div>
    </MotionConfig>
  );
}
