import { describe, expect, it } from "vitest";

import { agentSearchSchema, sourceCapsSchema } from "./search-schema";

const search = { id: "a1", name: "  Designers ", keywords: "designer", place: "", country: "NL", radiusKm: 25, remoteOnly: false, postedWithin: "any", enabled: true };

describe("agentSearchSchema", () => {
  it("trims the name and normalises the query like a search", () => {
    expect(agentSearchSchema.parse(search)).toMatchObject({ name: "Designers", country: "nl" });
  });

  it("needs a name, an id and the enabled flag", () => {
    expect(agentSearchSchema.safeParse({ ...search, name: "   " }).success).toBe(false);
    expect(agentSearchSchema.safeParse({ ...search, id: "" }).success).toBe(false);
    expect(agentSearchSchema.safeParse({ ...search, enabled: undefined }).success).toBe(false);
  });
});

describe("sourceCapsSchema", () => {
  it("takes 0 to 5 or all per provider", () => {
    expect(sourceCapsSchema.parse({ JSEARCH: 0, ADZUNA: "all", FREEHIRE: 5 })).toEqual({ JSEARCH: 0, ADZUNA: "all", FREEHIRE: 5 });
  });

  it("refuses other numbers, strings and providers", () => {
    expect(sourceCapsSchema.safeParse({ JSEARCH: 6 }).success).toBe(false);
    expect(sourceCapsSchema.safeParse({ JSEARCH: "2" }).success).toBe(false);
    expect(sourceCapsSchema.safeParse({ NOPE: 1 }).success).toBe(false);
  });
});
