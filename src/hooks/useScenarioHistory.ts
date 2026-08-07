"use client";

import {
  useCallback,
  useReducer,
  useRef,
  type SetStateAction,
} from "react";
import type { ScenarioInput } from "@/lib/projection";
import {
  SCENARIO_HISTORY_COALESCE_MS,
  SCENARIO_HISTORY_LIMIT,
  cloneScenario,
  diffScenarioPaths,
  sameChangedPaths,
  scenariosEqual,
} from "@/lib/scenario-diff";
import { flashChangePaths } from "@/lib/voice/flash-change";

export type ScenarioHistoryMode = "push" | "replace";

export type ScenarioChangeOptions = {
  /** `push` (default) records undo; `replace` clears stacks (reset / import / full replace). */
  history?: ScenarioHistoryMode;
};

type HistoryState = {
  present: ScenarioInput;
  past: ScenarioInput[];
  future: ScenarioInput[];
  coalesce: { at: number; paths: string[] } | null;
};

type HistoryAction =
  | {
      type: "commit";
      update: SetStateAction<ScenarioInput>;
      mode: ScenarioHistoryMode;
      now: number;
    }
  | { type: "undo" }
  | { type: "redo" };

function resolveUpdate(
  update: SetStateAction<ScenarioInput>,
  prev: ScenarioInput,
): ScenarioInput {
  return typeof update === "function" ? update(prev) : update;
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "commit": {
      const next = resolveUpdate(action.update, state.present);
      if (scenariosEqual(state.present, next)) {
        if (action.mode === "replace") {
          return {
            present: state.present,
            past: [],
            future: [],
            coalesce: null,
          };
        }
        return state;
      }
      const present = cloneScenario(next);
      if (action.mode === "replace") {
        return { present, past: [], future: [], coalesce: null };
      }

      const paths = diffScenarioPaths(state.present, next);
      const coalesce =
        !!state.coalesce &&
        action.now - state.coalesce.at < SCENARIO_HISTORY_COALESCE_MS &&
        sameChangedPaths(state.coalesce.paths, paths);

      if (coalesce) {
        return {
          present,
          past: state.past,
          future: [],
          coalesce: { at: action.now, paths },
        };
      }

      const past = [...state.past, cloneScenario(state.present)].slice(
        -SCENARIO_HISTORY_LIMIT,
      );
      return {
        present,
        past,
        future: [],
        coalesce: { at: action.now, paths },
      };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const past = state.past.slice(0, -1);
      const previous = state.past[state.past.length - 1]!;
      return {
        present: previous,
        past,
        future: [cloneScenario(state.present), ...state.future],
        coalesce: null,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...future] = state.future;
      return {
        present: next!,
        past: [...state.past, cloneScenario(state.present)].slice(
          -SCENARIO_HISTORY_LIMIT,
        ),
        future,
        coalesce: null,
      };
    }
    default:
      return state;
  }
}

function flashAfterPaint(paths: string[]) {
  if (paths.length === 0) return;
  requestAnimationFrame(() => {
    flashChangePaths(paths);
  });
}

export function useScenarioHistory(initial: ScenarioInput) {
  const [state, dispatch] = useReducer(historyReducer, undefined, () => ({
    present: cloneScenario(initial),
    past: [] as ScenarioInput[],
    future: [] as ScenarioInput[],
    coalesce: null as HistoryState["coalesce"],
  }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const setScenario = useCallback(
    (update: SetStateAction<ScenarioInput>, opts?: ScenarioChangeOptions) => {
      dispatch({
        type: "commit",
        update,
        mode: opts?.history ?? "push",
        now: Date.now(),
      });
    },
    [],
  );

  const undo = useCallback(() => {
    const { past, present } = stateRef.current;
    if (past.length === 0) return;
    const previous = past[past.length - 1]!;
    const paths = diffScenarioPaths(present, previous);
    dispatch({ type: "undo" });
    flashAfterPaint(paths);
  }, []);

  const redo = useCallback(() => {
    const { future, present } = stateRef.current;
    if (future.length === 0) return;
    const next = future[0]!;
    const paths = diffScenarioPaths(present, next);
    dispatch({ type: "redo" });
    flashAfterPaint(paths);
  }, []);

  return {
    scenario: state.present,
    setScenario,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
