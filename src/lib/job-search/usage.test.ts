import { describe, expect, it } from "vitest";

import { MONTHLY_QUOTA, requestsInPastDays, trimUsage, usageLine } from "./usage";

const now = new Date("2026-10-31T12:00:00Z");

describe("trimUsage", () => {
  it("keeps the past 31 days and drops older ones", () => {
    const usage = { JSEARCH: { "2026-10-01": 3, "2026-09-28": 5 }, ADZUNA: { "2026-09-01": 1 } };
    expect(trimUsage(usage, now)).toEqual({ JSEARCH: { "2026-10-01": 3 }, ADZUNA: {} });
  });
});

describe("requestsInPastDays", () => {
  it("adds up only the days within the period", () => {
    const usage = { JSEARCH: { "2026-10-31": 2, "2026-10-02": 4, "2026-10-01": 8, "2026-09-20": 16 }, ADZUNA: { "2026-10-30": 1 } };
    expect(requestsInPastDays(usage, "JSEARCH", 30, now)).toBe(6);
    expect(requestsInPastDays(usage, "FREEHIRE", 30, now)).toBe(0);
  });
});

describe("usageLine", () => {
  it("says how much of the quota is used, where there is one", () => {
    expect(MONTHLY_QUOTA).toEqual({ JSEARCH: 200 });
    expect(usageLine("JSEARCH", 41)).toBe("Used in the past 30 days: 41 of 200 (counted by Dossier)");
  });

  it("gives just the count for a provider with a quota but no monthly figure", () => {
    expect(usageLine("ADZUNA", 12)).toBe("Used in the past 30 days: 12 (counted by Dossier)");
  });

  it("has nothing for a provider without a quota", () => {
    expect(usageLine("FREEHIRE", 3)).toBeNull();
    expect(usageLine("ARBEITSAGENTUR", 3)).toBeNull();
  });
});
