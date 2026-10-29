import { describe, expect, it } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";
import type { AgentRun } from "@/lib/settings";

import { pickToScore, planRequests } from "./plan";
import { DEFAULT_SOURCE_CAPS, type AgentSearch } from "./search-schema";

const now = new Date("2026-10-29T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const search = (id: string, country = "de"): AgentSearch => ({ ...EMPTY_QUERY, keywords: "designer", country, id, name: id, enabled: true });
const searches = [search("s1"), search("s2"), search("s3")];
const sources = ["JSEARCH", "ADZUNA", "FREEHIRE"] as const;
const runWith = (hours: number, requests: AgentRun["requests"]): AgentRun => ({ at: hoursAgo(hours), manual: false, message: null, requests });
const jsearchFor = (...ids: string[]) => ids.map((searchId) => ({ source: "JSEARCH" as const, searchId }));
const plan = (runs: AgentRun[] = [], caps = DEFAULT_SOURCE_CAPS, list = searches) => planRequests({ searches: list, sources, caps, runs, now });
const jsearchIds = (requests: { source: string; searchId: string }[]) => requests.filter((r) => r.source === "JSEARCH").map((r) => r.searchId);

describe("planRequests", () => {
  it("sends every search to uncapped providers and the first two to JSearch, grouped by search", () => {
    const { requests, skipped } = plan();
    expect(requests).toHaveLength(8);
    expect(requests.map((r) => `${r.searchId}:${r.source}`)).toEqual([
      "s1:JSEARCH", "s1:ADZUNA", "s1:FREEHIRE",
      "s2:JSEARCH", "s2:ADZUNA", "s2:FREEHIRE",
      "s3:ADZUNA", "s3:FREEHIRE",
    ]);
    expect(skipped).toEqual([{ source: "JSEARCH", reason: "cap", cap: 2, searchIds: ["s3"] }]);
  });

  it("counts requests from the past 24 hours against the cap", () => {
    const { requests, skipped } = plan([runWith(20, jsearchFor("s1", "s2"))]);
    expect(jsearchIds(requests)).toEqual([]);
    expect(skipped).toEqual([{ source: "JSEARCH", reason: "cap", cap: 2, searchIds: ["s1", "s2", "s3"] }]);
  });

  it("stops counting requests from 24 hours ago, and picks never-run searches first, then ties in list order", () => {
    const { requests } = plan([runWith(25, jsearchFor("s1", "s2"))]);
    expect(jsearchIds(requests)).toEqual(["s1", "s3"]);
  });

  it("does not count a request made exactly 24 hours ago", () => {
    expect(jsearchIds(plan([runWith(24, jsearchFor("s1", "s2"))]).requests)).toEqual(["s1", "s3"]);
  });

  it("goes by the newest run that requested the pair", () => {
    const runs = [runWith(30, jsearchFor("s3")), runWith(40, jsearchFor("s1", "s3")), runWith(50, jsearchFor("s2"))];
    // Never: none. Oldest last-run first: s2 (50 h), s1 (40 h), s3 (30 h).
    expect(jsearchIds(plan(runs).requests)).toEqual(["s1", "s2"]);
  });

  it("leaves out a provider capped at 0 without reporting it", () => {
    const { requests, skipped } = plan([], { JSEARCH: 0 });
    expect(jsearchIds(requests)).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("never plans the Bundesagentur", () => {
    const { requests } = planRequests({ searches, sources: ["ARBEITSAGENTUR"], caps: {}, runs: [], now });
    expect(requests).toEqual([]);
  });

  it("skips a search whose country the provider doesn't cover, without spending the cap", () => {
    const list = [searches[0]!, search("s2", "ie"), searches[2]!];
    const { requests, skipped } = plan([], { JSEARCH: 2, ADZUNA: 2 }, list);
    expect(requests.filter((r) => r.source === "ADZUNA").map((r) => r.searchId)).toEqual(["s1", "s3"]);
    expect(requests.filter((r) => r.source === "JSEARCH").map((r) => r.searchId)).toEqual(["s1", "s2"]);
    expect(skipped).toEqual([{ source: "JSEARCH", reason: "cap", cap: 2, searchIds: ["s3"] }]);
  });

  it("holds the cap even when two searches share an id", () => {
    const { requests } = plan([], { JSEARCH: 1 }, [search("x"), search("x")]);
    expect(requests.filter((r) => r.source === "JSEARCH")).toHaveLength(1);
  });
});

describe("pickToScore", () => {
  const post = (id: string, postedAt: string | null) => ({ id, postedAt });
  const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

  it("takes one per search in turn, newest first within a search", () => {
    const by = new Map([
      ["s1", [1, 5, 3, 2, 4].map((n) => post(`a${n}`, day(n)))],
      ["s2", [post("b1", day(9))]],
      ["s3", [post("c1", day(1)), post("c2", day(2))]],
    ]);
    const picked = pickToScore(by, ["s1", "s2", "s3"], 5);
    expect(picked.map((p) => `${p.searchId}:${p.posting.id}`)).toEqual(["s1:a5", "s2:b1", "s3:c2", "s1:a4", "s3:c1"]);
  });

  it("puts undated postings last within a search", () => {
    const by = new Map([["s1", [post("x", null), post("y", day(1))]]]);
    expect(pickToScore(by, ["s1"], 5).map((p) => p.posting.id)).toEqual(["y", "x"]);
  });

  it("stops when every list is empty, and ignores searches without postings", () => {
    const by = new Map([["s1", [post("x", day(1))]]]);
    expect(pickToScore(by, ["s0", "s1"], 10)).toHaveLength(1);
    expect(pickToScore(by, ["s1"], 0)).toEqual([]);
  });
});
