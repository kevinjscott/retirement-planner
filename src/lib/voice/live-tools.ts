import { Type, type FunctionDeclaration, type Tool } from "@google/genai";

/** Tool names for the retirement planner Gemini Live session. */
export const VOICE_TOOL = {
  getScenario: "get_scenario",
  getPageResults: "get_page_results",
  getUiContext: "get_ui_context",
  captureScreenshot: "capture_screenshot",
  updateScenario: "update_scenario",
  batchUpdate: "batch_update",
  addAccount: "add_account",
  updateAccount: "update_account",
  removeAccount: "remove_account",
  reorderAccounts: "reorder_accounts",
  addIncome: "add_income",
  updateIncome: "update_income",
  removeIncome: "remove_income",
  reorderIncomes: "reorder_incomes",
  addEvent: "add_event",
  updateEvent: "update_event",
  removeEvent: "remove_event",
  reorderEvents: "reorder_events",
  link529: "link_529",
  addMilestone: "add_personal_milestone",
  updateMilestone: "update_personal_milestone",
  removeMilestone: "remove_personal_milestone",
  resetScenario: "reset_scenario",
  replaceScenario: "replace_scenario",
} as const;

const MACHINE =
  "Machine-only — never speak the tool name aloud. Prefer ids from get_scenario when available.";

const declarations: FunctionDeclaration[] = [
  {
    name: VOICE_TOOL.getScenario,
    description: `Read editable scenario inputs (accounts, incomes, events, taxes, spend, draw order). ${MACHINE}`,
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: VOICE_TOOL.getPageResults,
    description: `Read computed/visible page content: chart insights, milestones, ending nest egg, runway/deplete age, draw-order comparison, and year-by-year values (taxes, balances, draws, shortfall). Pass calendarYear (e.g. 2036), age, or yearOffset for a specific year; set includeSeries true for the full series. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        calendarYear: {
          type: Type.NUMBER,
          description: "Calendar year e.g. 2036",
        },
        age: { type: Type.NUMBER },
        yearOffset: {
          type: Type.NUMBER,
          description: "Years from now (0 = start year)",
        },
        includeSeries: {
          type: Type.BOOLEAN,
          description: "Include full year-by-year series (large)",
        },
      },
    },
  },
  {
    name: VOICE_TOOL.getUiContext,
    description: `Read the focused UI target (field path, label, value) for deixis like "this". Mouse hover is ignored — only document focus counts. If hasTarget is false / NO TARGET, ask which field — never assume the first Current balances row. ${MACHINE}`,
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: VOICE_TOOL.captureScreenshot,
    description: `Capture a JPEG screenshot of the planner UI and send it to you for visual context when "this" is ambiguous. ${MACHINE}`,
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: VOICE_TOOL.updateScenario,
    description: `Patch top-level scenario scalars: age, endAge, inflationPct, spendMode, annualSpend, withdrawPct, order, modelTaxes, stateCode, taxableCostBasisPct, defaultFund. Pass EVERY scalar you intend to change in this single call — never one field per call. For mixed scalar + account/income/event edits, use batch_update instead. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        age: { type: Type.NUMBER },
        endAge: { type: Type.NUMBER },
        inflationPct: {
          type: Type.NUMBER,
          description: "Inflation as percent, e.g. 3 for 3%",
        },
        spendMode: {
          type: Type.STRING,
          description: "fixed | percent",
        },
        annualSpend: { type: Type.NUMBER },
        withdrawPct: {
          type: Type.NUMBER,
          description: "Percent mode withdraw rate; 4 or 0.04 both ok",
        },
        order: {
          type: Type.STRING,
          description:
            "taxable-trad-roth | taxable-roth-trad | pro-rata",
        },
        modelTaxes: { type: Type.BOOLEAN },
        stateCode: { type: Type.STRING, description: "US state code e.g. WA" },
        taxableCostBasisPct: {
          type: Type.NUMBER,
          description: "Cost basis percent of taxable investments, e.g. 50",
        },
        defaultFund: {
          type: Type.STRING,
          description:
            "checking|cash|conservative|moderate|aggressive|sp500|custom",
        },
      },
    },
  },
  {
    name: VOICE_TOOL.batchUpdate,
    description: `Apply multiple independent edits in ONE call and flash all changed fields once. Prefer this whenever the user changes more than one field or more than one row. Put scalars under scenario; one object per account/income/event/milestone to update; and/or a changes[] list of {path, value} (data-voice-path style, e.g. age or accounts.<id>.balance). Never serialize one-by-one update_* calls for independent changes — only serialize when a later edit needs an earlier tool result (e.g. new id). ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        scenario: {
          type: Type.OBJECT,
          description:
            "Same scalar fields as update_scenario — include every scalar to change",
          properties: {
            age: { type: Type.NUMBER },
            endAge: { type: Type.NUMBER },
            inflationPct: { type: Type.NUMBER },
            spendMode: { type: Type.STRING },
            annualSpend: { type: Type.NUMBER },
            withdrawPct: { type: Type.NUMBER },
            order: { type: Type.STRING },
            modelTaxes: { type: Type.BOOLEAN },
            stateCode: { type: Type.STRING },
            taxableCostBasisPct: { type: Type.NUMBER },
            defaultFund: { type: Type.STRING },
          },
        },
        accounts: {
          type: Type.ARRAY,
          description: "One update_account-shaped object per account to patch",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              matchLabel: { type: Type.STRING },
              label: { type: Type.STRING },
              newLabel: { type: Type.STRING },
              kind: { type: Type.STRING },
              balance: { type: Type.NUMBER },
              fund: { type: Type.STRING },
              customReturnPct: { type: Type.NUMBER },
              liquidFromYear: { type: Type.NUMBER },
              linkedEventId: { type: Type.STRING },
            },
          },
        },
        incomes: {
          type: Type.ARRAY,
          description: "One update_income-shaped object per income to patch",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              matchLabel: { type: Type.STRING },
              label: { type: Type.STRING },
              newLabel: { type: Type.STRING },
              annualAmount: { type: Type.NUMBER },
              startAge: { type: Type.NUMBER },
              endAge: { type: Type.NUMBER },
              inflates: { type: Type.BOOLEAN },
            },
          },
        },
        events: {
          type: Type.ARRAY,
          description: "One update_event-shaped object per event to patch",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              matchLabel: { type: Type.STRING },
              label: { type: Type.STRING },
              newLabel: { type: Type.STRING },
              kind: { type: Type.STRING },
              startYear: { type: Type.NUMBER },
              durationYears: { type: Type.NUMBER },
              annualCost: { type: Type.NUMBER },
            },
          },
        },
        milestones: {
          type: Type.ARRAY,
          description:
            "One update_personal_milestone-shaped object per milestone to patch",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              matchLabel: { type: Type.STRING },
              label: { type: Type.STRING },
              newLabel: { type: Type.STRING },
              yearOffset: { type: Type.NUMBER },
            },
          },
        },
        changes: {
          type: Type.ARRAY,
          description:
            "Optional path/value list. path uses data-voice-path form (age, annualSpend, accounts.<id>.balance). value may be number, string, or boolean.",
          items: {
            type: Type.OBJECT,
            properties: {
              path: {
                type: Type.STRING,
                description:
                  "e.g. age, inflationPct, accounts.<id>.balance, incomes.<id>.annualAmount",
              },
              value: {
                type: Type.STRING,
                description:
                  "New value as string, number, or bool (JSON-ish strings ok)",
              },
              matchLabel: {
                type: Type.STRING,
                description:
                  "When path id is unknown, match account/income/event/milestone by label",
              },
            },
            required: ["path", "value"],
          },
        },
      },
    },
  },
  {
    name: VOICE_TOOL.addAccount,
    description: `Add an account (taxable, roth, traditional, 401k, 529). ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        kind: { type: Type.STRING },
        label: { type: Type.STRING },
        balance: { type: Type.NUMBER },
        fund: { type: Type.STRING },
        customReturnPct: { type: Type.NUMBER },
        liquidFromYear: {
          type: Type.NUMBER,
          description: "Calendar year when liquid; 0/omit = now",
        },
        linkedEventId: { type: Type.STRING },
      },
      required: ["kind"],
    },
  },
  {
    name: VOICE_TOOL.updateAccount,
    description: `Update an account by id or matchLabel. Pass EVERY field for that account in this single call. Use newLabel to rename when matching by label. For multiple accounts or mixed with scalars, use batch_update. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        matchLabel: { type: Type.STRING },
        label: { type: Type.STRING },
        newLabel: { type: Type.STRING },
        kind: { type: Type.STRING },
        balance: { type: Type.NUMBER },
        fund: { type: Type.STRING },
        customReturnPct: { type: Type.NUMBER },
        liquidFromYear: { type: Type.NUMBER },
        linkedEventId: { type: Type.STRING },
      },
    },
  },
  {
    name: VOICE_TOOL.removeAccount,
    description: `Remove an account by id or label. Confirm verbally for large balances. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        label: { type: Type.STRING },
      },
    },
  },
  {
    name: VOICE_TOOL.reorderAccounts,
    description: `Reorder accounts; orderedIds must include every account id exactly once. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderedIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["orderedIds"],
    },
  },
  {
    name: VOICE_TOOL.addIncome,
    description: `Add an income stream (SS, pension, rental, etc.). ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        annualAmount: { type: Type.NUMBER },
        startAge: { type: Type.NUMBER },
        endAge: { type: Type.NUMBER },
        inflates: { type: Type.BOOLEAN },
      },
    },
  },
  {
    name: VOICE_TOOL.updateIncome,
    description: `Update an income stream by id or matchLabel. Pass every field for that stream in one call; use batch_update for multiple streams. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        matchLabel: { type: Type.STRING },
        label: { type: Type.STRING },
        newLabel: { type: Type.STRING },
        annualAmount: { type: Type.NUMBER },
        startAge: { type: Type.NUMBER },
        endAge: { type: Type.NUMBER },
        inflates: { type: Type.BOOLEAN },
      },
    },
  },
  {
    name: VOICE_TOOL.removeIncome,
    description: `Remove an income stream by id or label. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        label: { type: Type.STRING },
      },
    },
  },
  {
    name: VOICE_TOOL.reorderIncomes,
    description: `Reorder income streams by full orderedIds list. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderedIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["orderedIds"],
    },
  },
  {
    name: VOICE_TOOL.addEvent,
    description: `Add a major expense/event (college, wedding, home, other). ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        kind: { type: Type.STRING },
        label: { type: Type.STRING },
        startYear: {
          type: Type.NUMBER,
          description: "Years from now (0 = current calendar year)",
        },
        durationYears: { type: Type.NUMBER },
        annualCost: { type: Type.NUMBER },
      },
    },
  },
  {
    name: VOICE_TOOL.updateEvent,
    description: `Update a major expense/event by id or matchLabel. Pass every field for that event in one call; use batch_update for multiple events. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        matchLabel: { type: Type.STRING },
        label: { type: Type.STRING },
        newLabel: { type: Type.STRING },
        kind: { type: Type.STRING },
        startYear: { type: Type.NUMBER },
        durationYears: { type: Type.NUMBER },
        annualCost: { type: Type.NUMBER },
      },
    },
  },
  {
    name: VOICE_TOOL.removeEvent,
    description: `Remove a major expense/event; clears linked 529s. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        label: { type: Type.STRING },
      },
    },
  },
  {
    name: VOICE_TOOL.reorderEvents,
    description: `Reorder events by full orderedIds list. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderedIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["orderedIds"],
    },
  },
  {
    name: VOICE_TOOL.link529,
    description: `Link a 529 account to an event, or clear with empty accountId. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING },
        accountId: {
          type: Type.STRING,
          description: "529 account id; omit/empty to clear",
        },
      },
      required: ["eventId"],
    },
  },
  {
    name: VOICE_TOOL.addMilestone,
    description: `Add a personal timeline milestone. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        yearOffset: { type: Type.NUMBER },
      },
    },
  },
  {
    name: VOICE_TOOL.updateMilestone,
    description: `Update a personal milestone by id or matchLabel. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        matchLabel: { type: Type.STRING },
        label: { type: Type.STRING },
        newLabel: { type: Type.STRING },
        yearOffset: { type: Type.NUMBER },
      },
    },
  },
  {
    name: VOICE_TOOL.removeMilestone,
    description: `Remove a personal milestone. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        label: { type: Type.STRING },
      },
    },
  },
  {
    name: VOICE_TOOL.resetScenario,
    description: `Reset to the default starter scenario. Only after clear user confirmation. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        confirmed: { type: Type.BOOLEAN },
      },
      required: ["confirmed"],
    },
  },
  {
    name: VOICE_TOOL.replaceScenario,
    description: `Replace the entire scenario object (advanced). Requires confirmed=true. ${MACHINE}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        confirmed: { type: Type.BOOLEAN },
        scenario: { type: Type.OBJECT },
      },
      required: ["confirmed", "scenario"],
    },
  },
];

export function buildRetirementVoiceLiveTools(): Tool[] {
  return [{ functionDeclarations: declarations }];
}
