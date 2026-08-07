import {
  GoogleGenAI,
  Modality,
  type RealtimeInputConfig,
  type SafetySetting,
  type Tool,
} from "@google/genai";
import {
  DEFAULT_LIVE_MODEL,
  readGeminiApiKeyFromEnv,
} from "@/lib/gemini-live/constants";
import { GEMINI_LIVE_SAFETY_SETTINGS } from "@/lib/gemini-live/safety-settings";
import {
  DEFAULT_GEMINI_LIVE_VOICE,
  type GeminiLiveVoiceId,
} from "@/lib/gemini-live/voices";
import { VOICE_LIVE_REALTIME_INPUT_CONFIG } from "@/lib/voice/audio-config";

export type EphemeralLiveAuthTokenResult = {
  token: string;
  model: string;
  expiresAt: string;
};

function getGeminiApiKey(): string {
  const apiKey = readGeminiApiKeyFromEnv();
  if (!apiKey || apiKey.startsWith("op://")) {
    throw new Error("gemini_not_configured");
  }
  return apiKey;
}

const LIVE_TOKEN_EXPIRE_MS = 2 * 60 * 60 * 1000;

function defaultExpireTimes(): {
  expireTime: string;
  newSessionExpireTime: string;
} {
  const now = Date.now();
  return {
    expireTime: new Date(now + LIVE_TOKEN_EXPIRE_MS).toISOString(),
    newSessionExpireTime: new Date(now + LIVE_TOKEN_EXPIRE_MS).toISOString(),
  };
}

function newGenAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });
}

function isInvalidGeminiApiKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("API_KEY_INVALID") ||
      error.message.includes("API key not valid"))
  );
}

/**
 * Ephemeral token with Live session constraints baked in (locked browser setup).
 * Adapted from aitools-pgahq-com.
 */
export async function createLockedGeminiLiveAuthToken(input: {
  systemInstruction: string;
  voiceName?: GeminiLiveVoiceId;
  tools?: Tool[];
  realtimeInputConfig?: RealtimeInputConfig;
}): Promise<EphemeralLiveAuthTokenResult> {
  const apiKey = getGeminiApiKey();
  const voiceName = input.voiceName ?? DEFAULT_GEMINI_LIVE_VOICE;
  const model = process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL;
  const { expireTime, newSessionExpireTime } = defaultExpireTimes();
  const client = newGenAiClient(apiKey);

  const liveConfig: {
    responseModalities: Modality[];
    systemInstruction: string;
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: GeminiLiveVoiceId } };
    };
    inputAudioTranscription: Record<string, never>;
    outputAudioTranscription: Record<string, never>;
    realtimeInputConfig: typeof VOICE_LIVE_REALTIME_INPUT_CONFIG;
    safetySettings: SafetySetting[];
    tools?: Tool[];
  } = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: input.systemInstruction,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig:
      input.realtimeInputConfig ?? VOICE_LIVE_REALTIME_INPUT_CONFIG,
    safetySettings: GEMINI_LIVE_SAFETY_SETTINGS,
  };

  if (input.tools !== undefined && input.tools.length > 0) {
    liveConfig.tools = input.tools;
  }

  try {
    const token = await client.authTokens.create({
      config: {
        uses: 0,
        expireTime,
        newSessionExpireTime,
        httpOptions: { apiVersion: "v1alpha" },
        liveConnectConstraints: {
          model,
          config: liveConfig,
        },
      },
    });

    return {
      token: token.name ?? "",
      model,
      expiresAt: expireTime,
    };
  } catch (error) {
    if (isInvalidGeminiApiKeyError(error)) {
      throw new Error("gemini_invalid_api_key");
    }
    throw error;
  }
}
