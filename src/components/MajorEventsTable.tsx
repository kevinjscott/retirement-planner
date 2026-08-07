"use client";

import {
  DeferredNumberInput,
  formatWithCommas,
} from "@/components/DeferredNumberInput";
import { YearSliderPicker } from "@/components/YearSliderPicker";
import {
  EVENT_KIND_LABEL,
  isCollegeEvent,
  type Account,
  type LifeEvent,
  type LifeEventKind,
} from "@/lib/projection";

const KIND_OPTIONS = Object.keys(EVENT_KIND_LABEL) as LifeEventKind[];

export function MajorEventsTable({
  events,
  accounts,
  horizon,
  currentAge,
  calendarStartYear,
  onChange,
  onLink529,
  onRemove,
}: {
  events: LifeEvent[];
  accounts: Account[];
  horizon: number;
  currentAge: number;
  calendarStartYear: number;
  onChange: (id: string, patch: Partial<LifeEvent>) => void;
  onLink529: (eventId: string, accountId: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const five29s = accounts.filter((a) => a.kind === "529");

  return (
    <div className="vbg-custom-events">
      <div className="vbg-custom-events-head" aria-hidden="true">
        <span>Kind</span>
        <span>Name</span>
        <span>Start</span>
        <span>Years</span>
        <span title="Today's dollars; grows with inflation each year">Cost/yr</span>
        <span>529</span>
        <span />
      </div>
      <div className="vbg-custom-events-rows">
        {events.length === 0 ? (
          <p className="vbg-helper vbg-custom-events-empty">No major expenses yet</p>
        ) : null}
        {events.map((ev) => {
          const startCal = calendarStartYear + ev.startYear;
          const ageAtStart = currentAge + ev.startYear;
          const linkedIds = five29s
            .filter((a) => a.linkedEventId === ev.id)
            .map((a) => a.id);
          const primary529 = linkedIds[0] ?? "";
          const college = isCollegeEvent(ev);
          const costLabel =
            ev.durationYears <= 1
              ? "Total cost (today's $)"
              : "Cost per year (today's $)";

          return (
            <div className="vbg-custom-events-row" key={ev.id} data-voice-path={`events.${ev.id}`}>
              <select
                aria-label="Kind"
                className="wealth-row-select"
                data-voice-path={`events.${ev.id}.kind`}
                value={ev.kind}
                onChange={(e) => {
                  const kind = e.target.value as LifeEventKind;
                  onChange(ev.id, { kind });
                  if (kind !== "college") onLink529(ev.id, null);
                }}
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {EVENT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Name"
                className="wealth-row-input"
                data-voice-path={`events.${ev.id}.label`}
                value={ev.label}
                placeholder="Name"
                onChange={(e) => onChange(ev.id, { label: e.target.value })}
              />
              <YearSliderPicker
                value={startCal}
                min={calendarStartYear}
                max={calendarStartYear + Math.max(0, horizon - 1)}
                ariaLabel={`Start calendar year, age ${ageAtStart}`}
                dialogLabel="Choose start year"
                sliderLabel="Start year"
                title={`Age ${ageAtStart}`}
                voicePath={`events.${ev.id}.startYear`}
                onChange={(cal) => {
                  if (cal === null) return;
                  const offset = Math.max(
                    0,
                    Math.min(
                      horizon - 1,
                      Math.round(cal) - calendarStartYear,
                    ),
                  );
                  const durationYears = Math.min(
                    ev.durationYears,
                    Math.max(1, horizon - offset),
                  );
                  onChange(ev.id, { startYear: offset, durationYears });
                }}
              />
              <YearSliderPicker
                value={ev.durationYears}
                min={1}
                max={Math.max(1, horizon - ev.startYear)}
                ariaLabel="Duration years"
                dialogLabel="Choose duration"
                sliderLabel="Duration (years)"
                voicePath={`events.${ev.id}.durationYears`}
                onChange={(n) => {
                  if (n === null) return;
                  onChange(ev.id, {
                    durationYears: Math.max(
                      1,
                      Math.min(horizon - ev.startYear, Math.round(n)),
                    ),
                  });
                }}
              />
              <div
                className="vbg-unit-field wealth-row-money"
                title={costLabel}
                data-voice-path={`events.${ev.id}.annualCost`}
              >
                <span className="vbg-unit-prefix">$</span>
                <DeferredNumberInput
                  aria-label={costLabel}
                  inputMode="numeric"
                  data-voice-path={`events.${ev.id}.annualCost`}
                  value={ev.annualCost}
                  format={formatWithCommas}
                  onCommit={(n) => {
                    if (n === null) return;
                    onChange(ev.id, { annualCost: Math.max(0, n) });
                  }}
                />
              </div>
              {college ? (
                <select
                  aria-label="Linked 529"
                  className="wealth-row-select"
                  data-voice-path={`events.${ev.id}.linked529`}
                  value={primary529}
                  title={
                    linkedIds.length > 1
                      ? `Also: ${five29s
                          .filter((a) => linkedIds.includes(a.id) && a.id !== primary529)
                          .map((a) => a.label)
                          .join(", ")}`
                      : undefined
                  }
                  onChange={(e) =>
                    onLink529(ev.id, e.target.value ? e.target.value : null)
                  }
                >
                  <option value="">None</option>
                  {five29s.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                      {linkedIds.includes(a.id) && linkedIds.length > 1
                        ? " · +"
                        : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="vbg-meta vbg-custom-events-na">—</span>
              )}
              <button
                type="button"
                className="wealth-row-remove"
                aria-label={`Remove ${ev.label}`}
                data-voice-path={`events.${ev.id}`}
                onClick={() => onRemove(ev.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function defaultEventForKind(
  kind: LifeEventKind,
  existing: LifeEvent[],
): Omit<LifeEvent, "id"> {
  const last = existing[existing.length - 1];
  const startYear = last ? last.startYear + Math.max(1, last.durationYears) : 2;
  switch (kind) {
    case "college":
      return {
        kind,
        label: `Kid ${existing.filter((e) => e.kind === "college").length + 1} college`,
        startYear,
        durationYears: 4,
        annualCost: 45_000,
      };
    case "wedding":
      return {
        kind,
        label: "Wedding",
        startYear,
        durationYears: 1,
        annualCost: 50_000,
      };
    case "home":
      return {
        kind,
        label: "Second home",
        startYear,
        durationYears: 1,
        annualCost: 200_000,
      };
    default:
      return {
        kind: "other",
        label: "Major expense",
        startYear,
        durationYears: 1,
        annualCost: 25_000,
      };
  }
}
