import { GEMINI_LIVE_SAFETY_SETTINGS } from "@/lib/gemini-live/safety-settings";
import { VOICE_LIVE_REALTIME_INPUT_CONFIG } from "@/lib/voice/audio-config";
import { parseResponseMessages } from "./parse-response";
import { MultimodalLiveResponseType, type LiveResponse } from "./types";

const LIVE_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export type GeminiLiveCloseInfo = {
  code: number;
  reason: string;
  wasClean: boolean;
};

type LiveTool = {
  functionDeclarations: readonly Record<string, unknown>[];
};

type LiveToolResponse = {
  id?: string;
  name: string;
  response: Record<string, unknown>;
};

export type GeminiLiveSessionResumptionConfig = {
  handle?: string;
  transparent?: boolean;
};

export type GeminiLiveClientOptions = {
  token: string;
  model: string;
  systemInstruction: string;
  tools?: readonly LiveTool[];
  /** When true, send only the minimal model setup required by constrained live sessions. */
  setupLocked?: boolean;
  voiceName?: string;
  sessionResumption?: GeminiLiveSessionResumptionConfig;
  onResponse: (message: LiveResponse) => void;
  onSetupComplete?: () => void;
  onOpen?: () => void;
  onClose?: (info: GeminiLiveCloseInfo) => void;
  onError?: (message: string) => void;
};

/** Browser WebSocket client for Gemini Live — adapted from aitools-pgahq-com. */
export class GeminiLiveClient {
  private webSocket: WebSocket | null = null;
  private connected = false;
  private setupComplete = false;
  private sessionResumption: GeminiLiveSessionResumptionConfig;

  constructor(private readonly options: GeminiLiveClientOptions) {
    this.sessionResumption = {
      transparent: true,
      ...options.sessionResumption,
    };
  }

  setSessionResumptionHandle(handle: string | undefined) {
    this.sessionResumption = {
      ...this.sessionResumption,
      handle: handle || undefined,
    };
  }

  get isConnected() {
    return this.connected && this.setupComplete;
  }

  connect() {
    const url = `${LIVE_WS_BASE}?access_token=${encodeURIComponent(this.options.token)}`;
    this.webSocket = new WebSocket(url);
    this.setupComplete = false;

    this.webSocket.onclose = (event) => {
      this.connected = false;
      this.setupComplete = false;
      this.options.onClose?.({
        code: event.code,
        reason: event.reason || "Connection closed",
        wasClean: event.wasClean,
      });
    };

    this.webSocket.onerror = () => {
      this.options.onError?.("WebSocket connection error");
    };

    this.webSocket.onopen = () => {
      this.connected = true;
      this.sendSetup();
      this.options.onOpen?.();
    };

    this.webSocket.onmessage = (event) => {
      void this.handleMessage(event);
    };
  }

  disconnect() {
    this.webSocket?.close();
    this.webSocket = null;
    this.connected = false;
    this.setupComplete = false;
  }

  reconnect() {
    this.disconnect();
    this.connect();
  }

  sendAudioMessage(base64Pcm: string) {
    this.send({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Pcm,
        },
      },
    });
  }

  sendTextMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.send({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: true,
      },
    });
  }

  /** Send a JPEG/PNG screenshot plus optional caption for deixis (“this”). */
  sendImageMessage(input: {
    mimeType: string;
    base64: string;
    caption?: string;
  }) {
    const parts: Array<Record<string, unknown>> = [
      {
        inlineData: {
          mimeType: input.mimeType,
          data: input.base64,
        },
      },
    ];
    const caption = input.caption?.trim();
    if (caption) {
      parts.push({ text: caption });
    }
    this.send({
      clientContent: {
        turns: [{ role: "user", parts }],
        turnComplete: true,
      },
    });
  }

  sendToolResponse(functionResponses: LiveToolResponse[]) {
    this.send({
      toolResponse: {
        functionResponses,
      },
    });
  }

  private send(payload: Record<string, unknown>) {
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(payload));
    }
  }

  private buildSessionResumptionSetup(): Record<string, unknown> {
    const setup: Record<string, unknown> = {
      transparent: this.sessionResumption.transparent ?? true,
    };
    if (this.sessionResumption.handle) {
      setup.handle = this.sessionResumption.handle;
    }
    return setup;
  }

  private sendSetup() {
    const sessionResumption = this.buildSessionResumptionSetup();

    if (this.options.setupLocked) {
      this.send({
        setup: {
          model: `models/${this.options.model}`,
          sessionResumption,
        },
      });
      return;
    }

    const voiceName = this.options.voiceName ?? "Puck";
    const setup: Record<string, unknown> = {
      model: `models/${this.options.model}`,
      sessionResumption,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: this.options.systemInstruction }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: VOICE_LIVE_REALTIME_INPUT_CONFIG,
      safetySettings: GEMINI_LIVE_SAFETY_SETTINGS,
    };

    if (this.options.tools?.length) {
      setup.tools = this.options.tools;
    }

    this.send({ setup });
  }

  private async handleMessage(event: MessageEvent) {
    let jsonData: string;
    if (event.data instanceof Blob) {
      jsonData = await event.data.text();
    } else if (event.data instanceof ArrayBuffer) {
      jsonData = new TextDecoder().decode(event.data);
    } else {
      jsonData = String(event.data);
    }

    try {
      const messageData = JSON.parse(jsonData) as Record<string, unknown>;
      const responses = parseResponseMessages(messageData);
      for (const response of responses) {
        if (response.type === MultimodalLiveResponseType.ERROR) {
          this.options.onError?.(String(response.data));
          continue;
        }

        if (
          response.type === MultimodalLiveResponseType.SETUP_COMPLETE &&
          !this.setupComplete
        ) {
          this.setupComplete = true;
          this.options.onSetupComplete?.();
        }
        this.options.onResponse(response);
      }
    } catch {
      this.options.onError?.("Failed to parse Live API message");
    }
  }
}
