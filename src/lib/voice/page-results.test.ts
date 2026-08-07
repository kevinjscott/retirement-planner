import { describe, expect, it } from "bun:test";
import { DEFAULT_SCENARIO } from "@/lib/projection";
import { getPageResults } from "@/lib/voice/page-results";

describe("getPageResults", () => {
  it("returns insights, milestones, and results without a year filter", () => {
    const page = getPageResults(DEFAULT_SCENARIO);
    expect(page.ok).toBe(true);
    expect(page.data.insights).toBeArray();
    expect(page.data.milestones).toBeArray();
    expect(page.data.results).toBeTruthy();
    expect(page.data.year).toBeUndefined();
    expect(page.summary.length).toBeGreaterThan(0);
  });

  it("returns year detail for a calendar year", () => {
    const start = new Date().getFullYear();
    const page = getPageResults(DEFAULT_SCENARIO, {
      calendarYear: start + 5,
    });
    expect(page.data.year).toBeTruthy();
    const year = page.data.year as { calendarYear: number; taxes: number };
    expect(year.calendarYear).toBe(start + 5);
    expect(typeof year.taxes).toBe("number");
  });

  it("includes full series when requested", () => {
    const page = getPageResults(DEFAULT_SCENARIO, { includeSeries: true });
    expect(page.data.series).toBeArray();
    expect((page.data.series as unknown[]).length).toBeGreaterThan(1);
  });
});
