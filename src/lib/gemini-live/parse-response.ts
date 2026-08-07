import { MultimodalLiveResponseType, type LiveResponse } from "./types";

/** Adapted from aitools-pgahq-com Gemini Live frame parsing. */
export function parseResponseMessages(
  data: Record<string, unknown>,
): LiveResponse[] {
  const responses: LiveResponse[] = [];
  const serverContent = data.serverContent as
    | Record<string, unknown>
    | undefined;
  const modelTurn = serverContent?.modelTurn as
    | { parts?: Array<Record<string, unknown>> }
    | undefined;
  const parts = modelTurn?.parts;

  try {
    if (data.error) {
      const err = data.error as { message?: string; code?: number };
      responses.push({
        type: MultimodalLiveResponseType.ERROR,
        data:
          err.message ?? `Live API error (${String(err.code ?? "unknown")})`,
        endOfTurn: true,
      });
      return responses;
    }

    if (data.setupComplete) {
      responses.push({
        type: MultimodalLiveResponseType.SETUP_COMPLETE,
        data: "",
        endOfTurn: false,
      });
      return responses;
    }

    if (data.goAway) {
      responses.push({
        type: MultimodalLiveResponseType.GOAWAY,
        data: data.goAway as Record<string, unknown>,
        endOfTurn: false,
      });
      return responses;
    }

    if (data.sessionResumptionUpdate) {
      responses.push({
        type: MultimodalLiveResponseType.SESSION_RESUMPTION_UPDATE,
        data: data.sessionResumptionUpdate as Record<string, unknown>,
        endOfTurn: false,
      });
      return responses;
    }

    if (data.toolCall) {
      responses.push({
        type: MultimodalLiveResponseType.TOOL_CALL,
        data: data.toolCall as Record<string, unknown>,
        endOfTurn: false,
      });
      return responses;
    }

    if (parts?.length) {
      for (const part of parts) {
        const inlineData = part.inlineData as { data?: string } | undefined;
        if (inlineData?.data) {
          responses.push({
            type: MultimodalLiveResponseType.AUDIO,
            data: inlineData.data,
            endOfTurn: false,
          });
        } else if (typeof part.text === "string") {
          responses.push({
            type: MultimodalLiveResponseType.TEXT,
            data: part.text,
            endOfTurn: false,
          });
        }
      }
    }

    const inputTranscription = serverContent?.inputTranscription as
      | { text?: string; finished?: boolean }
      | undefined;
    if (inputTranscription) {
      responses.push({
        type: MultimodalLiveResponseType.INPUT_TRANSCRIPTION,
        data: {
          text: inputTranscription.text ?? "",
          finished: inputTranscription.finished ?? false,
        },
        endOfTurn: false,
      });
    }

    const outputTranscription = serverContent?.outputTranscription as
      | { text?: string; finished?: boolean }
      | undefined;
    if (outputTranscription) {
      responses.push({
        type: MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION,
        data: {
          text: outputTranscription.text ?? "",
          finished: outputTranscription.finished ?? false,
        },
        endOfTurn: false,
      });
    }

    if (serverContent?.interrupted) {
      responses.push({
        type: MultimodalLiveResponseType.INTERRUPTED,
        data: "",
        endOfTurn: false,
      });
    }

    if (serverContent?.turnComplete) {
      responses.push({
        type: MultimodalLiveResponseType.TURN_COMPLETE,
        data: "",
        endOfTurn: true,
      });
    }
  } catch {
    // Malformed frames are ignored; WS close/error handlers surface failures.
  }

  return responses;
}
