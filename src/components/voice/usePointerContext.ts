"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyPointerUiContext,
  snapshotPointerUiContext,
  type PointerUiContext,
} from "@/lib/voice/pointer-context";

const STATE_THROTTLE_MS = 120;

/**
 * Track the focused plan control for voice deixis.
 *
 * Focus is the sole pointer cue (no mouse hover / near-cursor tracking).
 * React state is throttled lightly for any UI that reads `context`;
 * `getLatest` always re-samples document.activeElement.
 */
export function usePointerContext(enabled: boolean) {
  const [context, setContext] = useState<PointerUiContext>(
    createEmptyPointerUiContext,
  );
  const latestRef = useRef<PointerUiContext>(createEmptyPointerUiContext());
  const rafRef = useRef<number | null>(null);
  const lastStateAtRef = useRef(0);
  const pendingStateRef = useRef(false);

  const publish = useCallback((snap: PointerUiContext, forceState: boolean) => {
    latestRef.current = snap;
    const now = Date.now();
    if (forceState || now - lastStateAtRef.current >= STATE_THROTTLE_MS) {
      lastStateAtRef.current = now;
      pendingStateRef.current = false;
      setContext(snap);
      return;
    }
    pendingStateRef.current = true;
  }, []);

  const getLatest = useCallback((): PointerUiContext => {
    const snap = snapshotPointerUiContext(document.activeElement);
    latestRef.current = snap;
    return snap;
  }, []);

  useEffect(() => {
    if (!enabled) {
      const empty = createEmptyPointerUiContext();
      latestRef.current = empty;
      setContext(empty);
      return;
    }

    const refresh = (forceState = false) => {
      publish(snapshotPointerUiContext(document.activeElement), forceState);
    };

    const schedule = (forceState = false) => {
      if (rafRef.current != null) {
        if (forceState) pendingStateRef.current = true;
        return;
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        refresh(forceState || pendingStateRef.current);
      });
    };

    const onFocusIn = () => schedule(true);
    const onFocusOut = () => schedule(true);

    refresh(true);
    const interval = window.setInterval(() => refresh(true), 1500);
    // Flush any throttled state so React consumers stay roughly current.
    const flush = window.setInterval(() => {
      if (pendingStateRef.current) refresh(true);
    }, STATE_THROTTLE_MS);

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(flush);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [enabled, publish]);

  return { context, getLatest };
}
