import { describe, expect, it } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";

import type { AgentSearch } from "./search-schema";
import { capOf, newSearchId, runnableSearches, searchesOf } from "./searches";

const saved = (over: Partial<AgentSearch> = {}): AgentSearch => ({ ...EMPTY_QUERY, id: "a1", name: "Designers", keywords: "designer", country: "nl", enabled: true, ...over });

describe("searchesOf", () => {
  it("returns the saved list, even an empty one", () => {
    const list = [saved()];
    expect(searchesOf({ agentSearches: list, agentQuery: { ...EMPTY_QUERY, keywords: "old" }, agentEnabled: true })).toBe(list);
    expect(searchesOf({ agentSearches: [], agentQuery: { ...EMPTY_QUERY, keywords: "old" }, agentEnabled: true })).toEqual([]);
  });

  it("stands the old single search in as 'legacy' while no list is saved", () => {
    const keywords = "x".repeat(100);
    const query = { ...EMPTY_QUERY, keywords, place: "Rotterdam", country: "nl", remoteOnly: true };
    expect(searchesOf({ agentSearches: null, agentQuery: query, agentEnabled: false })).toEqual([{ ...query, id: "legacy", name: "x".repeat(80), enabled: true }]);
  });

  it("is empty with no list and no keywords", () => {
    expect(searchesOf({ agentSearches: null, agentQuery: EMPTY_QUERY, agentEnabled: true })).toEqual([]);
  });
});

describe("runnableSearches", () => {
  it("drops a paused search and one without a country, keeping order", () => {
    const list = [saved({ id: "1" }), saved({ id: "2", enabled: false }), saved({ id: "3", country: "" }), saved({ id: "4", keywords: "" }), saved({ id: "5" })];
    expect(runnableSearches(list).map((search) => search.id)).toEqual(["1", "5"]);
  });
});

describe("capOf", () => {
  it("uses the stored cap, else all", () => {
    expect(capOf({ JSEARCH: 2 }, "JSEARCH")).toBe(2);
    expect(capOf({ JSEARCH: 2 }, "ADZUNA")).toBe("all");
  });

  it("is 0 for the Bundesagentur even when stored as all", () => {
    expect(capOf({ ARBEITSAGENTUR: "all" }, "ARBEITSAGENTUR")).toBe(0);
    expect(capOf({}, "ARBEITSAGENTUR")).toBe(0);
  });
});

describe("newSearchId", () => {
  it("makes a short, fresh id", () => {
    const id = newSearchId();
    expect(id).toHaveLength(12);
    expect(newSearchId()).not.toBe(id);
  });
});
