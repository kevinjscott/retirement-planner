import { createLockedGeminiLiveAuthToken } from "@/lib/gemini-live/ephemeral-auth-token";
import { readGeminiApiKeyFromEnv } from "@/lib/gemini-live/constants";
import { DEFAULT_GEMINI_LIVE_VOICE } from "@/lib/gemini-live/voices";
import { buildRetirementVoiceLiveTools } from "@/lib/voice/live-tools";
import { RETIREMENT_VOICE_SYSTEM_PROMPT } from "@/lib/voice/system-prompt";

export const runtime = "nodejs";

/**
 * Mint a locked Gemini Live ephemeral token for Voice mode.
 * Requires GEMINI_API_KEY or GOOGLE_API_KEY (same as aitools voice).
 */
export async function POST() {
  if (!readGeminiApiKeyFromEnv()) {
    return Response.json(
      {
        error:
          "GEMINI_API_KEY or GOOGLE_API_KEY is not configured. It is required for Voice mode.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await createLockedGeminiLiveAuthToken({
      systemInstruction: RETIREMENT_VOICE_SYSTEM_PROMPT,
      voiceName: DEFAULT_GEMINI_LIVE_VOICE,
      tools: buildRetirementVoiceLiveTools(),
    });

    if (!result.token) {
      return Response.json(
        { error: "Failed to create Live auth token" },
        { status: 502 },
      );
    }

    return Response.json({
      token: result.token,
      model: result.model,
      expiresAt: result.expiresAt,
      setupLocked: true,
      voiceName: DEFAULT_GEMINI_LIVE_VOICE,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "token_create_failed";
    if (message === "gemini_not_configured") {
      return Response.json(
        {
          error:
            "GEMINI_API_KEY or GOOGLE_API_KEY is not configured. It is required for Voice mode.",
        },
        { status: 503 },
      );
    }
    if (message === "gemini_invalid_api_key") {
      return Response.json(
        { error: "Gemini API key is invalid." },
        { status: 401 },
      );
    }
    console.error("[voice/live/token]", error);
    return Response.json(
      { error: "Could not create Gemini Live session token." },
      { status: 502 },
    );
  }
}
