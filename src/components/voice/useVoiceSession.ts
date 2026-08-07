"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPlayer } from "@/lib/audio/audio-player";
import {
  AudioStreamer,
  requestMicrophoneAccess,
} from "@/lib/audio/audio-streamer";
import { GeminiLiveClient } from "@/lib/gemini-live/client";
import { MultimodalLiveResponseType } from "@/lib/gemini-live/types";
import {
  executeVoiceToolCall,
  parseLiveFunctionCalls,
} from "@/lib/voice/execute-tool";
import { shouldBargeInOnUserMicVolume } from "@/lib/voice/audio-config";
import { flashChangePaths } from "@/lib/voice/flash-change";
import {
  capturePlannerScreenshot,
  formatPointerContextCue,
  type PointerUiContext,
} from "@/lib/voice/pointer-context";
import { summarizeScenario } from "@/lib/voice/mutations";
import { VOICE_TOOL } from "@/lib/voice/live-tools";
import type { ScenarioInput } from "@/lib/projection";
import type { ScenarioChangeOptions } from "@/hooks/useScenarioHistory";

export type VoiceConnectionState =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "listening"
  | "error";

type UseVoiceSessionOptions = {
  enabled: boolean;
  scenario: ScenarioInput;
  onScenarioChange: (
    next: ScenarioInput,
    opts?: ScenarioChangeOptions,
  ) => void;
  /** Fresh focus snapshot at call time (not stale React state). */
  getUiContext: () => PointerUiContext;
};

export function useVoiceSession({
  enabled,
  scenario,
  onScenarioChange,
  getUiContext,
}: UseVoiceSessionOptions) {
  const [connectionState, setConnectionState] =
    useState<VoiceConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  const [agentVolume, setAgentVolume] = useState(0);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const agentSpeakingHoldUntilRef = useRef(0);
  const scenarioRef = useRef(scenario);
  const getUiContextRef = useRef(getUiContext);
  const onScenarioChangeRef = useRef(onScenarioChange);
  const connectGenerationRef = useRef(0);

  // Keep refs live every render so tool handlers never read a stale closure
  // (useEffect would lag one commit behind UI/scenario edits).
  scenarioRef.current = scenario;
  getUiContextRef.current = getUiContext;
  onScenarioChangeRef.current = onScenarioChange;

  const teardown = useCallback(() => {
    streamerRef.current?.stop();
    streamerRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    playerRef.current?.destroy();
    playerRef.current = null;
    clientRef.current?.disconnect();
    clientRef.current = null;
    agentSpeakingHoldUntilRef.current = 0;
    setMicVolume(0);
    setAgentVolume(0);
  }, []);

  const handleUserMicVolume = useCallback((volume: number) => {
    setMicVolume(volume);
    if (
      shouldBargeInOnUserMicVolume(
        volume,
        agentSpeakingHoldUntilRef.current,
      ) &&
      playerRef.current
    ) {
      playerRef.current.interrupt();
      agentSpeakingHoldUntilRef.current = 0;
      setAgentVolume(0);
    }
  }, []);

  const handleAgentPlaybackVolume = useCallback(
    (volume: number, durationMs = 0) => {
      setAgentVolume(volume);
      agentSpeakingHoldUntilRef.current =
        Date.now() + Math.max(durationMs, 180) + 180;
    },
    [],
  );

  const disconnect = useCallback(() => {
    connectGenerationRef.current += 1;
    teardown();
    setConnectionState("idle");
    setError(null);
  }, [teardown]);

  const connect = useCallback(async () => {
    const generation = ++connectGenerationRef.current;
    const isStale = () => generation !== connectGenerationRef.current;

    setError(null);

    try {
      setConnectionState("requesting-mic");
      const mic = await requestMicrophoneAccess();
      if (isStale()) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      micStreamRef.current = mic;

      setConnectionState("connecting");
      const tokenRes = await fetch("/api/voice/live/token", { method: "POST" });
      if (isStale()) {
        mic.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        return;
      }
      const tokenBody = (await tokenRes.json()) as {
        token?: string;
        model?: string;
        setupLocked?: boolean;
        voiceName?: string;
        error?: string;
      };
      if (!tokenRes.ok || !tokenBody.token || !tokenBody.model) {
        throw new Error(
          tokenBody.error ?? "Could not start voice session token",
        );
      }

      const player = new AudioPlayer({
        onVolume: handleAgentPlaybackVolume,
      });
      await player.init();
      if (isStale()) {
        player.destroy();
        mic.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        return;
      }
      playerRef.current = player;

      const client = new GeminiLiveClient({
        token: tokenBody.token,
        model: tokenBody.model,
        systemInstruction: "",
        setupLocked: tokenBody.setupLocked !== false,
        voiceName: tokenBody.voiceName,
        onError: (message) => {
          if (isStale()) return;
          setError(message);
          setConnectionState("error");
        },
        onClose: () => {
          if (isStale()) return;
          streamerRef.current?.stop();
          streamerRef.current = null;
          setConnectionState((s) => (s === "listening" ? "idle" : s));
        },
        onSetupComplete: () => {
          if (isStale()) return;
          setConnectionState("listening");
          const opening = [
            "[Session start]",
            JSON.stringify(summarizeScenario(scenarioRef.current)),
            "Greet in one short friendly line. Offer to help with the plan.",
          ].join("\n");
          client.sendTextMessage(opening);
        },
        onResponse: (message) => {
          if (isStale()) return;
          if (message.type === MultimodalLiveResponseType.AUDIO) {
            if (typeof message.data === "string") {
              void player.play(message.data);
            }
            return;
          }

          if (message.type === MultimodalLiveResponseType.INTERRUPTED) {
            player.interrupt();
            agentSpeakingHoldUntilRef.current = 0;
            setAgentVolume(0);
            return;
          }

          // Transcription events ignored — no transcript UI.
          if (
            message.type === MultimodalLiveResponseType.INPUT_TRANSCRIPTION ||
            message.type === MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION
          ) {
            return;
          }

          if (message.type === MultimodalLiveResponseType.TOOL_CALL) {
            const calls = parseLiveFunctionCalls(message.data);
            void (async () => {
              const responses: Array<{
                id?: string;
                name: string;
                response: Record<string, unknown>;
              }> = [];
              let working = scenarioRef.current;
              // Coalesce flashes across parallel/same-turn tool calls so all
              // changed paths shimmer once together.
              const pendingFlashPaths: string[] = [];
              let turnHistory: ScenarioChangeOptions["history"] | null = null;
              let turnMutated = false;
              for (const call of calls) {
                if (isStale()) return;
                const uiNow = getUiContextRef.current();
                const result = executeVoiceToolCall(call, working, uiNow);
                if (result.scenario) {
                  working = result.scenario;
                  scenarioRef.current = working;
                  turnMutated = true;
                  const history: ScenarioChangeOptions["history"] =
                    call.name === VOICE_TOOL.resetScenario ||
                    call.name === VOICE_TOOL.replaceScenario
                      ? "replace"
                      : "push";
                  // Prefer replace if any call in the turn replaces; else one push.
                  turnHistory =
                    turnHistory === "replace" || history === "replace"
                      ? "replace"
                      : "push";
                }
                if (result.highlightPaths?.length) {
                  pendingFlashPaths.push(...result.highlightPaths);
                }
                if (result.requestScreenshot) {
                  const shot = await capturePlannerScreenshot();
                  if (shot && !isStale()) {
                    const cueCtx = getUiContextRef.current();
                    client.sendImageMessage({
                      mimeType: shot.mimeType,
                      base64: shot.base64,
                      caption:
                        "[Screenshot / UI field map for deixis]\n" +
                        formatPointerContextCue(cueCtx),
                    });
                  }
                }
                const uiAttach = getUiContextRef.current();
                responses.push({
                  id: result.id,
                  name: result.name,
                  response: {
                    ...result.response,
                    // Never imply a Current Holdings default when nothing is focused.
                    uiContext: uiAttach.hasTarget
                      ? uiAttach
                      : {
                          ...uiAttach,
                          noTarget:
                            "Nothing focused. Do not assume the first Current balances row.",
                        },
                  },
                });
              }
              if (turnMutated && turnHistory && !isStale()) {
                onScenarioChangeRef.current(working, { history: turnHistory });
              }
              if (pendingFlashPaths.length > 0 && !isStale()) {
                const uniquePaths = [...new Set(pendingFlashPaths)];
                // After paint so data-voice-path nodes reflect the new scenario.
                requestAnimationFrame(() => {
                  flashChangePaths(uniquePaths);
                });
              }
              if (responses.length > 0 && !isStale()) {
                client.sendToolResponse(responses);
              }
            })();
          }
        },
      });

      if (isStale()) {
        client.disconnect();
        player.destroy();
        mic.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        return;
      }

      clientRef.current = client;
      client.connect();

      const streamer = new AudioStreamer(client, {
        onVolume: handleUserMicVolume,
        onCaptureLost: (reason) => {
          if (isStale()) return;
          setError(reason);
          setConnectionState("error");
          teardown();
        },
      });
      streamerRef.current = streamer;
      await streamer.start(mic);
      if (isStale()) {
        teardown();
      }
    } catch (err) {
      if (isStale()) return;
      teardown();
      const message =
        err instanceof Error ? err.message : "Voice connection failed";
      setError(message);
      setConnectionState("error");
    }
  }, [handleAgentPlaybackVolume, handleUserMicVolume, teardown]);

  useEffect(() => {
    if (!enabled) {
      disconnect();
    }
  }, [enabled, disconnect]);

  useEffect(() => {
    if (!enabled || connectionState !== "listening") return;

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void playerRef.current?.resumeAfterBackground();
      void streamerRef.current?.resumeAfterBackground().catch((err) => {
        const message =
          err instanceof Error ? err.message : "Microphone became unavailable.";
        setError(message);
        setConnectionState("error");
        teardown();
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, connectionState, teardown]);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return {
    connectionState,
    error,
    micVolume,
    agentVolume,
    connect,
    disconnect,
  };
}
