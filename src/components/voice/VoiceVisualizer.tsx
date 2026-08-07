"use client";

import { useEffect, useRef } from "react";
import type { VoiceConnectionState } from "@/components/voice/useVoiceSession";
import styles from "./VoiceVisualizer.module.css";

type Props = {
  connectionState: VoiceConnectionState;
  micVolume: number;
  agentVolume: number;
  error: string | null;
  /** Compact header chip — no action buttons. */
  compact?: boolean;
};

function LoadingWave({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`${styles.loadingVisualizer}${compact ? ` ${styles.compactLoading}` : ""}`}
      aria-hidden="true"
    >
      <div className={styles.loadingWave}>
        <span />
        <span />
        <span />
        <span />
        <span />
        {compact ? null : (
          <>
            <span />
            <span />
          </>
        )}
      </div>
    </div>
  );
}

export function VoiceVisualizer({
  connectionState,
  micVolume,
  agentVolume,
  error,
  compact = false,
}: Props) {
  const visualizerRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const volumeRef = useRef({ user: 0, agent: 0 });
  const agentHeldUntilRef = useRef(0);
  const speakerRef = useRef("Quiet");

  useEffect(() => {
    volumeRef.current.user = Math.min(0.72, Math.max(micVolume, 0));
  }, [micVolume]);

  useEffect(() => {
    const target = Math.min(0.58, Math.max(agentVolume, 0) * 0.68);
    const current = volumeRef.current.agent;
    volumeRef.current.agent = current + (target - current) * 0.34;
    if (agentVolume > 0.02) {
      agentHeldUntilRef.current = Date.now() + 360;
    }
  }, [agentVolume]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const visualizer = visualizerRef.current;
      if (!visualizer) return;

      const keepAgentPulse = Date.now() < agentHeldUntilRef.current;
      volumeRef.current.user =
        volumeRef.current.user < 0.02 ? 0 : volumeRef.current.user * 0.78;
      const nextAgent =
        volumeRef.current.agent < 0.02 ? 0 : volumeRef.current.agent * 0.82;
      volumeRef.current.agent = keepAgentPulse
        ? Math.max(nextAgent, volumeRef.current.agent * 0.92)
        : nextAgent;

      const { user, agent } = volumeRef.current;
      visualizer.style.setProperty("--user-volume", user.toFixed(3));
      visualizer.style.setProperty("--agent-volume", agent.toFixed(3));

      const visualSpeaker =
        agent > 0.05 && agent > user + 0.04
          ? "Agent"
          : user > 0.06 && user > agent + 0.06
            ? "You"
            : "Quiet";

      visualizer.classList.toggle(styles.agentSpeaking, visualSpeaker === "Agent");
      visualizer.classList.toggle(styles.userSpeaking, visualSpeaker === "You");

      if (statusRef.current && speakerRef.current !== visualSpeaker) {
        speakerRef.current = visualSpeaker;
        statusRef.current.textContent = `Voice activity: ${visualSpeaker}`;
      }
    }, 120);

    return () => window.clearInterval(interval);
  }, []);

  const busy =
    connectionState === "requesting-mic" ||
    connectionState === "connecting";
  const live = connectionState === "listening";

  const title =
    error ??
    (busy
      ? connectionState === "requesting-mic"
        ? "Allow microphone…"
        : "Connecting…"
      : live
        ? "Voice on"
        : "Voice idle");

  return (
    <div
      aria-label={compact ? undefined : "Voice activity visualization"}
      title={title}
      className={`${styles.visualizerCard}${compact ? ` ${styles.compact}` : ""}${error ? ` ${styles.hasError}` : ""}`}
    >
      {busy ? (
        <LoadingWave compact={compact} />
      ) : (
        <>
          <div ref={visualizerRef} className={styles.zenVisualizer}>
            <div className={`${styles.voiceBlob} ${styles.agentVoiceBlob}`} />
            <div className={`${styles.voiceBlob} ${styles.userVoiceBlob}`} />
          </div>
          <span ref={statusRef} className={styles.srOnly} aria-live="polite">
            Voice activity: Quiet
          </span>
          <div
            className={`${styles.speakerLegend}${compact ? ` ${styles.compactLegend}` : ""}`}
            aria-hidden="true"
          >
            <span>{compact ? "AI" : "Assistant"}</span>
            <span>You</span>
          </div>
        </>
      )}

      {error && !compact ? (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
