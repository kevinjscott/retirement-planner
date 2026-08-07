"use client";

import { useEffect, useRef, useState } from "react";
import type { ScenarioInput } from "@/lib/projection";
import type { ScenarioChangeOptions } from "@/hooks/useScenarioHistory";
import { usePointerContext } from "@/components/voice/usePointerContext";
import { useVoiceSession } from "@/components/voice/useVoiceSession";
import { VoiceVisualizer } from "@/components/voice/VoiceVisualizer";

type Props = {
  scenario: ScenarioInput;
  onScenarioChange: (
    next: ScenarioInput,
    opts?: ScenarioChangeOptions,
  ) => void;
};

function MicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VoiceMode({ scenario, onScenarioChange }: Props) {
  const [enabled, setEnabled] = useState(false);
  const autoStartedRef = useRef(false);
  const { getLatest: getUiContext } = usePointerContext(enabled);
  const {
    connectionState,
    error,
    micVolume,
    agentVolume,
    connect,
    disconnect,
  } = useVoiceSession({
    enabled,
    scenario,
    onScenarioChange,
    getUiContext,
  });

  useEffect(() => {
    if (!enabled) {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current || connectionState !== "idle") return;
    autoStartedRef.current = true;
    void connect();
  }, [enabled, connect, connectionState]);

  const busy =
    connectionState === "requesting-mic" ||
    connectionState === "connecting";

  const toggle = () => {
    if (enabled) {
      disconnect();
      setEnabled(false);
      return;
    }
    setEnabled(true);
  };

  const title = error
    ? error
    : enabled
      ? busy
        ? "Connecting voice…"
        : "Voice on — click to turn off"
      : "Voice — talk to edit this scenario";

  return (
    <div className="vbg-voice-control">
      <button
        type="button"
        className="vbg-button"
        data-variant="secondary"
        data-voice-on={enabled ? "true" : undefined}
        aria-pressed={enabled}
        aria-label={enabled ? "Turn voice off" : "Turn voice on"}
        title={title}
        onClick={toggle}
      >
        <MicIcon />
        Voice
        {enabled ? (
          <VoiceVisualizer
            compact
            connectionState={connectionState}
            micVolume={micVolume}
            agentVolume={agentVolume}
            error={error}
          />
        ) : null}
      </button>
      {error && enabled ? (
        <span className="vbg-voice-error-chip" title={error} role="alert">
          !
        </span>
      ) : null}
    </div>
  );
}
