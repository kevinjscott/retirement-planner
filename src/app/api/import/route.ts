import { gateway } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import {
  chunkImportSourceText,
  IMPORT_SYSTEM_PROMPT,
  IMPORT_TEXT_CHAR_LIMIT,
  IMPORT_TEXT_MIN_CHUNK,
  importExtractionSchema,
  isContextLengthError,
  mergeImportExtractionList,
  summarizeScenarioForImport,
  type ImportExtraction,
  type ScenarioImportSummary,
} from "@/lib/scenario-import";
import type { ScenarioInput } from "@/lib/projection";

export const runtime = "nodejs";
/** Multi-chunk generateObject on large pastes can exceed a single 60s budget. */
export const maxDuration = 120;

const MODEL_ID = "openai/gpt-5.6-luna";

const GATEWAY_KEY_ALIASES = [
  "AI_GATEWAY_API_KEY",
  "VERCEL_AI_GATEWAY_API_KEY",
  "VERCEL_AI_GATEWAY_KEY",
] as const;

/** Prefer AI_GATEWAY_API_KEY; accept common aliases from the shell env. */
function ensureGatewayApiKey(): string | null {
  for (const name of GATEWAY_KEY_ALIASES) {
    const value = process.env[name]?.trim();
    if (value) {
      if (name !== "AI_GATEWAY_API_KEY") {
        process.env.AI_GATEWAY_API_KEY = value;
      }
      return value;
    }
  }
  return null;
}

type ImagePayload = {
  mediaType: string;
  base64: string;
};

function parseImages(raw: unknown): ImagePayload[] {
  if (!Array.isArray(raw)) return [];
  const out: ImagePayload[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const mediaType =
      typeof (item as { mediaType?: unknown }).mediaType === "string"
        ? (item as { mediaType: string }).mediaType
        : "";
    const base64 =
      typeof (item as { base64?: unknown }).base64 === "string"
        ? (item as { base64: string }).base64
        : "";
    if (!mediaType.startsWith("image/") || !base64) continue;
    if (base64.length > 5_500_000) continue;
    out.push({ mediaType, base64 });
  }
  return out.slice(0, 8);
}

function parseScenario(raw: unknown): ScenarioImportSummary | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    return summarizeScenarioForImport(raw as ScenarioInput);
  } catch {
    return null;
  }
}

function logExtraction(label: string, object: ImportExtraction) {
  console.info(`[import] ${label}`, {
    model: MODEL_ID,
    summary: object.summary,
    itemCount: object.items.length,
    items: object.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      valueLabel: item.valueLabel,
      explanation: item.explanation,
      matchExistingId: item.matchExistingId,
      suggestedResolution: item.suggestedResolution,
      matchExplanation: item.matchExplanation,
      accountFund:
        item.kind === "account" && item.account
          ? {
              fund: item.account.fund,
              investmentHint: item.account.investmentHint ?? null,
              customReturn: item.account.customReturn,
            }
          : null,
      defaultFundScalar:
        item.kind === "scalar" && item.scalar?.key === "defaultFund"
          ? item.scalar.value
          : null,
    })),
    fundMappings: object.items
      .filter((item) => item.kind === "account" && item.account)
      .map((item) => {
        const acct = item.account!;
        return {
          itemId: item.id,
          label: acct.label,
          modelFund: acct.fund,
          investmentHint: acct.investmentHint ?? null,
          customReturn: acct.customReturn,
        };
      }),
  });
}

function scenarioBlockFor(summary: ScenarioImportSummary | null): string {
  return summary
    ? `\n\nCURRENT SCENARIO (use these ids for matchExistingId when an extracted item updates an existing entity; null when adding new):\n${JSON.stringify(summary, null, 2)}`
    : "\n\nCURRENT SCENARIO: empty / unavailable — treat all list items as new (matchExistingId null, suggestedResolution add).";
}

async function extractChunk(opts: {
  chunkText: string;
  chunkIndex: number;
  chunkCount: number;
  images: ImagePayload[];
  scenarioBlock: string;
}): Promise<ImportExtraction> {
  const { chunkText, chunkIndex, chunkCount, images, scenarioBlock } = opts;
  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: string; mediaType: string }
  > = [];

  const chunkNote =
    chunkCount > 1
      ? `\n\nThis is chunk ${chunkIndex + 1} of ${chunkCount} of a longer paste. Extract every account/balance/field found in THIS chunk only; other chunks are handled separately and merged.`
      : "";

  content.push({
    type: "text",
    text: chunkText
      ? `Extract retirement scenario fields from this material, then propose merge matches against the current scenario.${scenarioBlock}${chunkNote}\n\n---\n${chunkText}`
      : `Extract retirement scenario fields from the attached page image(s). Only include values you can read clearly. Then propose merge matches against the current scenario.${scenarioBlock}`,
  });

  // Attach images only on the first chunk to avoid repeating large payloads.
  if (chunkIndex === 0) {
    for (const img of images) {
      content.push({
        type: "file",
        data: img.base64,
        mediaType: img.mediaType,
      });
    }
  }

  const { object } = await generateObject({
    model: gateway(MODEL_ID),
    schema: importExtractionSchema,
    schemaName: "RetirementImport",
    schemaDescription:
      "Confident field patches plus LLM merge proposals against the current scenario",
    system: IMPORT_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    temperature: 0.1,
  });

  return object;
}

/**
 * Cover-to-cover extract: one call when under the char budget; otherwise sequential
 * chunks. On context-length errors, re-chunk at half size (down to min) and retry.
 */
async function extractCoverToCover(opts: {
  text: string;
  images: ImagePayload[];
  scenarioBlock: string;
}): Promise<ImportExtraction> {
  const { text, images, scenarioBlock } = opts;
  let chunkLimit = IMPORT_TEXT_CHAR_LIMIT;
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const chunks = text
      ? chunkImportSourceText(text, chunkLimit).chunks
      : [""];

    console.info("[import] extract attempt", {
      attempt: attempt + 1,
      chunkLimit,
      chunkCount: chunks.length,
      textLength: text.length,
    });

    try {
      const extractions: ImportExtraction[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const object = await extractChunk({
          chunkText: chunks[i]!,
          chunkIndex: i,
          chunkCount: chunks.length,
          images,
          scenarioBlock,
        });
        logExtraction(
          chunks.length > 1
            ? `model output (chunk ${i + 1}/${chunks.length})`
            : "model output",
          object,
        );
        extractions.push(object);
      }

      const merged = mergeImportExtractionList(extractions);
      if (extractions.length > 1) {
        console.info("[import] merged chunks", {
          chunkCount: extractions.length,
          perChunkCounts: extractions.map((e) => e.items.length),
          mergedCount: merged.items.length,
          summary: merged.summary,
        });
      }
      return merged;
    } catch (err) {
      const canRetry =
        text.length > 0 &&
        isContextLengthError(err) &&
        chunkLimit > IMPORT_TEXT_MIN_CHUNK &&
        attempt < maxAttempts - 1;
      if (!canRetry) throw err;

      const nextLimit = Math.max(
        IMPORT_TEXT_MIN_CHUNK,
        Math.floor(chunkLimit / 2),
      );
      console.warn("[import] context length — rechunking", {
        from: chunkLimit,
        to: nextLimit,
        message: err instanceof Error ? err.message : String(err),
      });
      chunkLimit = nextLimit;
    }
  }

  throw new Error("Import extraction failed after context-length retries");
}

export async function POST(request: Request) {
  if (!ensureGatewayApiKey()) {
    return Response.json(
      {
        error:
          "AI_GATEWAY_API_KEY is not set. Export it in your shell (or add it to .env.local).",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text =
    body &&
    typeof body === "object" &&
    typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";
  const images = parseImages(
    body && typeof body === "object"
      ? (body as { images?: unknown }).images
      : undefined,
  );
  const scenarioSummary = parseScenario(
    body && typeof body === "object"
      ? (body as { scenario?: unknown }).scenario
      : undefined,
  );

  if (!text && images.length === 0) {
    return Response.json(
      { error: "Provide pasted text and/or page image(s) / screenshot(s)." },
      { status: 400 },
    );
  }

  const proactiveChunks = text
    ? chunkImportSourceText(text).chunks.length
    : 0;

  console.info("[import] request", {
    textLength: text.length,
    proactiveChunkCount: proactiveChunks || (text ? 1 : 0),
    charLimit: IMPORT_TEXT_CHAR_LIMIT,
    imageCount: images.length,
    imageMediaTypes: images.map((img) => img.mediaType),
    hasScenario: scenarioSummary != null,
    scenarioCounts: scenarioSummary
      ? {
          accounts: scenarioSummary.accounts.length,
          incomes: scenarioSummary.incomes.length,
          events: scenarioSummary.events.length,
          milestones: scenarioSummary.personalMilestones.length,
        }
      : null,
    model: MODEL_ID,
  });

  try {
    const merged = await extractCoverToCover({
      text,
      images,
      scenarioBlock: scenarioBlockFor(scenarioSummary),
    });
    return Response.json(merged);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Import extraction failed";
    console.error("[import] error", err);
    const missingKey = /AI_GATEWAY_API_KEY|api key|authentication/i.test(
      message,
    );
    return Response.json(
      {
        error: missingKey
          ? "AI Gateway authentication failed. Check AI_GATEWAY_API_KEY."
          : message,
      },
      { status: missingKey ? 503 : 502 },
    );
  }
}
