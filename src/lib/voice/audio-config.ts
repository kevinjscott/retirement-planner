import {
  EndSensitivity,
  StartSensitivity,
  type RealtimeInputConfig,
} from "@google/genai";

/** Gemini Live VAD tuned for browser mic capture in noisy environments. */
export const VOICE_LIVE_REALTIME_INPUT_CONFIG: RealtimeInputConfig = {
  automaticActivityDetection: {
    disabled: false,
    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
    prefixPaddingMs: 20,
    silenceDurationMs: 200,
  },
};

export const VOICE_NOISE_HANDLING_RULES = `- Ignore background voices, TV, music, keyboard, and ambient chatter unless the person is clearly speaking to you.
- Do not respond to brief non-speech sounds or distant conversations; wait until the person is addressing you directly.
- If speech is mixed with background noise or only partly intelligible, briefly ask them to repeat rather than guessing.`;

/** Min gated mic RMS to interrupt announcer playback while they are speaking. */
export const VOICE_LIVE_USER_BARGE_IN_VOLUME_THRESHOLD = 0.34;

export function shouldBargeInOnUserMicVolume(
  volume: number,
  agentSpeakingHoldUntilMs: number,
  now = Date.now(),
): boolean {
  return (
    volume >= VOICE_LIVE_USER_BARGE_IN_VOLUME_THRESHOLD &&
    now < agentSpeakingHoldUntilMs
  );
}
