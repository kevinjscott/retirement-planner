export const MultimodalLiveResponseType = {
  TEXT: "TEXT",
  AUDIO: "AUDIO",
  SETUP_COMPLETE: "SETUP_COMPLETE",
  INTERRUPTED: "INTERRUPTED",
  TURN_COMPLETE: "TURN_COMPLETE",
  TOOL_CALL: "TOOL_CALL",
  ERROR: "ERROR",
  INPUT_TRANSCRIPTION: "INPUT_TRANSCRIPTION",
  OUTPUT_TRANSCRIPTION: "OUTPUT_TRANSCRIPTION",
  GOAWAY: "GOAWAY",
  SESSION_RESUMPTION_UPDATE: "SESSION_RESUMPTION_UPDATE",
} as const;

export type MultimodalLiveResponseType =
  (typeof MultimodalLiveResponseType)[keyof typeof MultimodalLiveResponseType];

export type LiveResponse = {
  type: MultimodalLiveResponseType;
  data: string | Record<string, unknown>;
  endOfTurn: boolean;
};
