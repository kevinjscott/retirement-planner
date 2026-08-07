/** Default Gemini Live model (aitools uses the same). Override with GEMINI_LIVE_MODEL. */
export const DEFAULT_LIVE_MODEL =
  process.env.NEXT_PUBLIC_GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";

export function readGeminiApiKeyFromEnv(): string | undefined {
  const raw = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
