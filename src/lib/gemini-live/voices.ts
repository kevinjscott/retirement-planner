/**
 * Prebuilt Gemini Live voices.
 * Adapted from aitools-pgahq-com.
 */
export const GEMINI_LIVE_VOICE_OPTIONS = [
  { id: "Puck", description: "Upbeat" },
  { id: "Charon", description: "Informative" },
  { id: "Kore", description: "Firm" },
  { id: "Fenrir", description: "Excitable" },
  { id: "Aoede", description: "Breezy" },
] as const;

export type GeminiLiveVoiceId =
  (typeof GEMINI_LIVE_VOICE_OPTIONS)[number]["id"];

export const DEFAULT_GEMINI_LIVE_VOICE: GeminiLiveVoiceId = "Puck";

export function isGeminiLiveVoiceId(
  value: string,
): value is GeminiLiveVoiceId {
  return GEMINI_LIVE_VOICE_OPTIONS.some((v) => v.id === value);
}
