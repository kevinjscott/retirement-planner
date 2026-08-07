import {
  addAccount,
  addEvent,
  addIncome,
  addPersonalMilestone,
  batchUpdate,
  getScenarioTool,
  link529,
  removeAccount,
  removeEvent,
  removeIncome,
  removePersonalMilestone,
  reorderAccounts,
  reorderEvents,
  reorderIncomes,
  replaceScenario,
  resetScenario,
  updateAccount,
  updateEvent,
  updateIncome,
  updatePersonalMilestone,
  updateScenarioScalars,
  type VoiceMutationResult,
} from "@/lib/voice/mutations";
import { VOICE_TOOL } from "@/lib/voice/live-tools";
import { getPageResults } from "@/lib/voice/page-results";
import type { PointerUiContext } from "@/lib/voice/pointer-context";
import { formatPointerContextCue } from "@/lib/voice/pointer-context";
import type { ScenarioInput } from "@/lib/projection";

export type LiveFunctionCall = {
  id?: string;
  name?: string;
  args?: unknown;
};

export type VoiceToolExecution = {
  id?: string;
  name: string;
  response: Record<string, unknown>;
  scenario?: ScenarioInput;
  /** When set, client should capture and send a screenshot to the Live session. */
  requestScreenshot?: boolean;
  /** DOM paths to flash after a successful mutation. */
  highlightPaths?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLiveFunctionCalls(data: unknown): LiveFunctionCall[] {
  if (!isRecord(data)) return [];

  if (Array.isArray(data.functionCalls)) {
    return data.functionCalls.filter(isRecord).map((call) => ({
      id: typeof call.id === "string" ? call.id : undefined,
      name: typeof call.name === "string" ? call.name : undefined,
      args: call.args,
    }));
  }

  if (isRecord(data.functionCall)) {
    const call = data.functionCall;
    return [
      {
        id: typeof call.id === "string" ? call.id : undefined,
        name: typeof call.name === "string" ? call.name : undefined,
        args: call.args,
      },
    ];
  }

  return [];
}

function fromMutation(
  call: LiveFunctionCall,
  result: VoiceMutationResult,
): VoiceToolExecution {
  const didChange = result.ok && result.changed;
  return {
    id: call.id,
    name: call.name ?? "unknown",
    response: {
      status: result.ok ? "ok" : "error",
      changed: result.changed,
      summary: result.summary,
      ...(result.changedFields?.length
        ? { changedFields: result.changedFields }
        : {}),
      ...(result.alreadySet?.length ? { alreadySet: result.alreadySet } : {}),
      ...(result.error ? { error: result.error } : {}),
    },
    // No-ops must not update React state or flash UI.
    scenario: didChange ? result.scenario : undefined,
    highlightPaths: didChange ? result.highlightPaths : undefined,
  };
}

export function executeVoiceToolCall(
  call: LiveFunctionCall,
  scenario: ScenarioInput,
  uiContext: PointerUiContext,
): VoiceToolExecution {
  const name = call.name ?? "";
  switch (name) {
    case VOICE_TOOL.getScenario:
      return fromMutation(call, getScenarioTool(scenario));
    case VOICE_TOOL.getPageResults: {
      const page = getPageResults(scenario, call.args);
      return {
        id: call.id,
        name,
        response: {
          status: "ok",
          summary: page.summary,
          ...page.data,
        },
      };
    }
    case VOICE_TOOL.getUiContext:
      return {
        id: call.id,
        name,
        response: {
          status: "ok",
          hasTarget: uiContext.hasTarget,
          focused: uiContext.focused,
          cue: formatPointerContextCue(uiContext),
          ...(uiContext.hasTarget
            ? {}
            : {
                noTarget:
                  "Nothing focused. Do not assume the first Current Holdings row. Ask which field.",
              }),
        },
      };
    case VOICE_TOOL.captureScreenshot:
      return {
        id: call.id,
        name,
        response: {
          status: "ok",
          summary: "Screenshot will be sent as an image turn.",
        },
        requestScreenshot: true,
      };
    case VOICE_TOOL.updateScenario:
      return fromMutation(call, updateScenarioScalars(scenario, call.args));
    case VOICE_TOOL.batchUpdate:
      return fromMutation(call, batchUpdate(scenario, call.args));
    case VOICE_TOOL.addAccount:
      return fromMutation(call, addAccount(scenario, call.args));
    case VOICE_TOOL.updateAccount:
      return fromMutation(call, updateAccount(scenario, call.args));
    case VOICE_TOOL.removeAccount:
      return fromMutation(call, removeAccount(scenario, call.args));
    case VOICE_TOOL.reorderAccounts:
      return fromMutation(call, reorderAccounts(scenario, call.args));
    case VOICE_TOOL.addIncome:
      return fromMutation(call, addIncome(scenario, call.args));
    case VOICE_TOOL.updateIncome:
      return fromMutation(call, updateIncome(scenario, call.args));
    case VOICE_TOOL.removeIncome:
      return fromMutation(call, removeIncome(scenario, call.args));
    case VOICE_TOOL.reorderIncomes:
      return fromMutation(call, reorderIncomes(scenario, call.args));
    case VOICE_TOOL.addEvent:
      return fromMutation(call, addEvent(scenario, call.args));
    case VOICE_TOOL.updateEvent:
      return fromMutation(call, updateEvent(scenario, call.args));
    case VOICE_TOOL.removeEvent:
      return fromMutation(call, removeEvent(scenario, call.args));
    case VOICE_TOOL.reorderEvents:
      return fromMutation(call, reorderEvents(scenario, call.args));
    case VOICE_TOOL.link529:
      return fromMutation(call, link529(scenario, call.args));
    case VOICE_TOOL.addMilestone:
      return fromMutation(call, addPersonalMilestone(scenario, call.args));
    case VOICE_TOOL.updateMilestone:
      return fromMutation(call, updatePersonalMilestone(scenario, call.args));
    case VOICE_TOOL.removeMilestone:
      return fromMutation(call, removePersonalMilestone(scenario, call.args));
    case VOICE_TOOL.resetScenario:
      return fromMutation(call, resetScenario(scenario, call.args));
    case VOICE_TOOL.replaceScenario:
      return fromMutation(call, replaceScenario(scenario, call.args));
    default:
      return {
        id: call.id,
        name: name || "unknown",
        response: {
          status: "error",
          error: `Unknown tool: ${name}`,
        },
      };
  }
}
