import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { jobSearchError } from "@/lib/job-search/errors";
import { searchQuerySchema, type FoundPosting, type JobSource, type SearchQuery } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { sweepFinishedJobs } from "@/lib/jobs/retention";
import { saveSettings, loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { MockProvider } from "../ai/providers/mock";

import { agentDedupeKey } from "./candidates";
import { runAgentScan } from "./run";
import { DEFAULT_SOURCE_CAPS, type AgentSearch } from "./search-schema";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Drafts are their own jobs; here it's enough to see them queued.
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "draft-job"),
}));
// The sweep also removes old PDF zips, which isn't what's tested here.
vi.mock("@/lib/jobs/zip-pdfs", () => ({ removeOldZips: async () => {} }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});

// A fake for each provider that notes its requests, and a fake AI that scores by title.
const fake = vi.hoisted(() => ({
  postings: [] as FoundPosting[],
  /** What a provider answers a search with; by default `postings`. */
  respond: null as ((source: JobSource, query: SearchQuery) => FoundPosting[]) | null,
  requests: [] as [JobSource, string][],
  sourcesOn: ["JSEARCH"] as JobSource[],
  noKey: [] as JobSource[],
  ai: true,
  failOn: null as string | null,
  onScore: (() => {}) as (title: string) => void,
}));
vi.mock("@/lib/job-search", () => ({
  searchPostings: vi.fn(async (source: JobSource, _credentials: unknown, query: SearchQuery) => {
    fake.requests.push([source, query.keywords]);
    return { postings: fake.respond ? fake.respond(source, query) : fake.postings, next: "page-2" };
  }),
}));
vi.mock("@/lib/job-search/config", async () => {
  const { jobSearchError } = await import("@/lib/job-search/errors");
  return {
    loadJobSearchConfig: async () => ({ sourcesOn: fake.sourcesOn, source: fake.sourcesOn[0] ?? null, saved: true }),
    credentialsFor: (_config: unknown, source: JobSource) => {
      if (fake.noKey.includes(source)) throw jobSearchError("no-key", source);
      return { key: `${source.toLowerCase()}-key` };
    },
    requestContext: () => ({}),
  };
});
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => fake.ai }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        const { title } = JSON.parse(call.messages[0].content.split("The posting's facts:\n")[1].split("\n\nThe posting:")[0]) as { title: string };
        fake.onScore(title);
        if (title === fake.failOn) return "not json at all";
        return { score: /senior/i.test(title) ? 90 : /designer/i.test(title) ? 75 : 40, reasons: [`Fits ${title}.`], redFlags: [] };
      },
    }),
}));

const prisma = () => db.client!;
const query: SearchQuery = { keywords: "Product designer", place: "Rotterdam", country: "nl", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
const saved = (id: string, keywords: string, extra: Partial<AgentSearch> = {}): AgentSearch => ({ ...query, id, name: keywords, keywords, enabled: true, ...extra });
const designer = saved("designer", "Product designer");
const now = new Date("2026-10-20T08:00:00Z");
const hour = 60 * 60 * 1000;

const posting = (id: string, title: string, posted: string, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH",
  externalId: id,
  title,
  company: `Company ${id}`,
  place: "Rotterdam",
  remote: false,
  salary: "",
  postedAt: posted,
  url: `https://jobs.example/${id}?utm_source=x`,
  via: "LinkedIn",
  description: `${title} at Company ${id}.`,
  complete: false,
  ...extra,
});
const page = [
  posting("a", "Senior Product Designer", "2026-10-19T00:00:00Z"),
  posting("b", "Product Designer", "2026-10-18T00:00:00Z"),
  // No link: its dedupe key is company, title and place.
  posting("c", "Office Manager", "2026-10-17T00:00:00Z", { url: "" }),
];

const context = (abort?: AbortController): JobContext & { steps: string[] } => {
  const steps: string[] = [];
  return { id: "agent-job", steps, step: async (name) => void steps.push(name), signal: (abort ?? new AbortController()).signal };
};

beforeEach(async () => {
  await resetDatabase(prisma());
  Object.assign(fake, { postings: page, respond: null, requests: [], sourcesOn: ["JSEARCH"], noKey: [], ai: true, failOn: null, onScore: () => {} });
  // One saved search on JSearch, without a cap, unless a test says otherwise.
  await saveSettings({ agentEnabled: true, agentSearches: [designer], agentSourceCaps: {} });
});
afterAll(() => prisma().$disconnect());

describe("runAgentScan (E16-3)", () => {
  it("searches once, scores the new postings and keeps them, below the minimum too", async () => {
    const run = context();
    const result = await runAgentScan({ manual: false }, run, now);
    expect(fake.requests.length).toBe(1);
    expect(run.steps).toEqual(["Searching for new postings", "Scoring 3 postings"]);
    const message = "Searched 1 job type on JSearch. 2 new postings are waiting for a look.";
    expect(result).toEqual({ found: 3, fresh: 3, scored: 3, drafted: 0, skipped: 0, message });
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { score: "desc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score, candidate.status])).toEqual([
      ["a", 90, "SCORED"],
      ["b", 75, "SCORED"],
      ["c", 40, "SCORED"],
    ]);
    expect(candidates[0]).toMatchObject({ title: "Senior Product Designer", reasons: ["Fits Senior Product Designer."], dedupeKey: agentDedupeKey(page[0]), searchId: "designer", searchName: "Product designer" });
    // Find jobs shows the scores too (#208).
    expect((await prisma().postingScore.findMany({ orderBy: { score: "desc" } })).map((row) => [row.externalId, row.score])).toEqual([["a", 90], ["b", 75], ["c", 40]]);
    // The run is on record, with how it ended.
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message, requests: [{ source: "JSEARCH", searchId: "designer" }] }]);
  });

  it("scores the newest new postings first, up to the cap", async () => {
    await saveSettings({ agentMaxScores: 2 });
    const scoredTitles: string[] = [];
    fake.onScore = (title) => scoredTitles.push(title);
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(scoredTitles).toEqual(["Senior Product Designer", "Product Designer"]);
    expect(result).toMatchObject({ fresh: 3, scored: 2 });
  });

  it("never brings back what it has seen, from another run or another source", async () => {
    await runAgentScan({ manual: false }, context(), now);
    const again = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(again).toEqual({ found: 3, fresh: 0, scored: 0, drafted: 0, skipped: 3, message: "Searched 1 job type on JSearch. No new postings this time." });

    // The same jobs from Adzuna: one by its link, one by company, title and place.
    fake.postings = [
      posting("az-1", "Senior Product Designer", "2026-10-19T00:00:00Z", { source: "ADZUNA", url: "https://jobs.example/a?utm_medium=y" }),
      posting("az-2", "Office  Manager", "2026-10-18T00:00:00Z", { source: "ADZUNA", url: "", company: "COMPANY c" }),
      posting("az-3", "Brand Designer", "2026-10-20T00:00:00Z", { source: "ADZUNA" }),
    ];
    const third = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 4 * hour));
    expect(third).toMatchObject({ found: 3, fresh: 1, scored: 1, skipped: 2 });
  });

  it("leaves out postings saved, dismissed or applied for in Find jobs", async () => {
    const application = await prisma().application.create({ data: {} });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "a", savedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "b", dismissedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "c", applicationId: application.id } });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 3, fresh: 0, skipped: 3 });
    expect(await prisma().agentCandidate.count()).toBe(0);
  });

  it("stops without asking a provider when it's off, not set up, or has run 3 times in 24 hours", async () => {
    const stop = async (manual = false) => (await runAgentScan({ manual }, context(), now)).message;
    await saveSettings({ agentEnabled: false });
    expect(await stop()).toBe("The job agent is off.");
    await saveSettings({ agentEnabled: true, agentSearches: [] });
    expect(await stop()).toBe("Add a saved search in Settings → Job agent first.");
    // Paused, or without keywords or a country, a search doesn't run.
    await saveSettings({ agentSearches: [{ ...designer, enabled: false }, saved("blank", " "), saved("nowhere", "Writer", { country: "" })] });
    expect(await stop()).toBe("Add a saved search in Settings → Job agent first.");
    await saveSettings({ agentSearches: [designer] });
    fake.sourcesOn = [];
    expect(await stop()).toBe("Turn on JSearch, Adzuna or FreeHire in Settings → Job search first.");
    // It never searches the Bundesagentur für Arbeit on its own (#223).
    fake.sourcesOn = ["ARBEITSAGENTUR"];
    expect(await stop()).toBe("Turn on JSearch, Adzuna or FreeHire in Settings → Job search first.");
    fake.sourcesOn = ["JSEARCH"];
    fake.ai = false;
    expect(await stop()).toBe("Choose an AI provider in Settings → AI provider first.");
    expect(fake.requests.length).toBe(0);
    expect((await loadSettings()).agentRuns).toEqual([]);
  });

  it("holds the daily limit from its own record, whatever the task-data sweep deletes", async () => {
    await saveSettings({ jobRetentionHours: 1 });
    for (const hours of [0, 2, 4]) {
      // Each run's Job row, as the runner leaves it, which the sweep deletes an hour later.
      const at = new Date(now.getTime() + hours * hour);
      await prisma().job.create({ data: { type: "agent-scan", key: "agent", status: "DONE", input: { manual: true }, finishedAt: at } });
      await runAgentScan({ manual: true }, context(), at);
      await sweepFinishedJobs(new Date(now.getTime() + (hours + 1.5) * hour));
    }
    expect(fake.requests.length).toBe(3);
    expect(await prisma().job.count()).toBe(0);
    const fourth = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 6 * hour));
    expect(fourth.message).toBe("The agent has run 3 times in the past 24 hours, as many as it may. Try again in 18 hours.");
    expect(fake.requests.length).toBe(3);
    // A day after the first, one may go again.
    await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 24 * hour + 1));
    expect(fake.requests.length).toBe(4);
  });

  it("records the run before it asks a provider, so a failing provider still counts", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    vi.mocked(searchPostings).mockRejectedValueOnce(new Error("socket hang up"));
    await expect(runAgentScan({ manual: false }, context(), now)).rejects.toThrow("socket hang up");
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: null, requests: [{ source: "JSEARCH", searchId: "designer" }] }]);
  });

  it("goes on when one score fails, and says what failed when none worked", async () => {
    fake.failOn = "Product Designer";
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ scored: 2 });
    expect((await prisma().agentCandidate.findMany()).map((candidate) => candidate.externalId).sort()).toEqual(["a", "c"]);

    await prisma().agentCandidate.deleteMany();
    fake.postings = [page[1]];
    const failed = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(failed).toMatchObject({ scored: 0, message: "Searched 1 job type on JSearch. The model's answer didn't come back in the expected shape. Try again." });
  });

  it("stops between postings when it's cancelled", async () => {
    const abort = new AbortController();
    fake.onScore = () => abort.abort();
    const result = await runAgentScan({ manual: false }, context(abort), now);
    expect(result.scored).toBeLessThanOrEqual(1);
    expect(await prisma().agentCandidate.count()).toBeLessThanOrEqual(1);
  });

  it("queues drafts for the best new postings when auto-draft is on, up to the cap (#197)", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    vi.mocked(startJob).mockClear();
    expect((await runAgentScan({ manual: false }, context(), now)).drafted).toBe(0);
    expect(startJob).not.toHaveBeenCalled();

    await prisma().agentCandidate.deleteMany();
    await saveSettings({ agentAutoDraft: true, agentMaxDrafts: 1 });
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(result).toMatchObject({ scored: 3, drafted: 1, message: "Searched 1 job type on JSearch. 2 new postings are waiting for a look. Preparing a draft for the best one." });
    const best = await prisma().agentCandidate.findFirstOrThrow({ where: { externalId: "a" } });
    expect(startJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: best.id }, { key: `agent-candidate:${best.id}` });
  });

  it("says when nothing reached the minimum score", async () => {
    fake.postings = [page[2]];
    expect((await runAgentScan({ manual: false }, context(), now)).message).toBe("Searched 1 job type on JSearch. Scored 1 new posting; none reached your minimum score of 70.");
    expect(demoProfile().basics.name).toBe("Jane Doe");
  });
});

describe("runAgentScan with several saved searches and providers", () => {
  const searches = [designer, saved("researcher", "UX researcher"), saved("writer", "UX writer")];
  /** One posting for each search on each provider, its own job. */
  const perRequest = (source: JobSource, { keywords }: SearchQuery) => {
    const id = `${source}-${keywords}`.toLowerCase().replace(/\W+/g, "-");
    return [posting(id, `${keywords} at ${source}`, "2026-10-19T00:00:00Z", { source, url: `https://jobs.example/${id}` })];
  };
  const runs = async () => (await loadSettings()).agentRuns;

  beforeEach(async () => {
    Object.assign(fake, { sourcesOn: ["JSEARCH", "ADZUNA", "FREEHIRE"], respond: perRequest });
    await saveSettings({ agentSearches: searches, agentSourceCaps: DEFAULT_SOURCE_CAPS });
  });

  it("sends each search to each provider, JSearch up to its daily cap, search by search", async () => {
    const result = await runAgentScan({ manual: false }, context(), now);
    const order: [JobSource, string][] = [
      ["JSEARCH", "designer"],
      ["ADZUNA", "designer"],
      ["FREEHIRE", "designer"],
      ["JSEARCH", "researcher"],
      ["ADZUNA", "researcher"],
      ["FREEHIRE", "researcher"],
      ["ADZUNA", "writer"],
      ["FREEHIRE", "writer"],
    ];
    const keywords = new Map(searches.map((search) => [search.id, search.keywords]));
    expect(fake.requests).toEqual(order.map(([source, id]) => [source, keywords.get(id)]));
    expect((await runs())[0].requests).toEqual(order.map(([source, searchId]) => ({ source, searchId })));
    expect(result).toMatchObject({ found: 8, fresh: 8, scored: 8 });
    expect(result.message).toMatch(/^Searched 3 job types on Adzuna and FreeHire, and 2 on JSearch \(its limit of 2 a day\)\. /);
    const tags = await prisma().agentCandidate.findMany({ select: { source: true, searchId: true, searchName: true }, orderBy: [{ searchId: "asc" }, { source: "asc" }] });
    expect(tags.filter((tag) => tag.searchId === "writer")).toEqual([
      { source: "ADZUNA", searchId: "writer", searchName: "UX writer" },
      { source: "FREEHIRE", searchId: "writer", searchName: "UX writer" },
    ]);
  });

  it("skips a provider without its key, and says so", async () => {
    fake.noKey = ["JSEARCH"];
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(fake.requests.map(([source]) => source)).not.toContain("JSEARCH");
    expect(result.message).toContain("Searched 3 job types on Adzuna and FreeHire. JSearch was skipped: Add your JSearch key in Settings → Job search first.");
    expect((await runs())[0].requests.map((request) => request.source)).not.toContain("JSEARCH");
    expect(result.scored).toBe(6);
  });

  it("ends the run, on record, when no provider that's on has its key", async () => {
    fake.noKey = ["JSEARCH", "ADZUNA", "FREEHIRE"];
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(fake.requests).toEqual([]);
    expect(result.message).toBe(
      "JSearch was skipped: Add your JSearch key in Settings → Job search first. Adzuna was skipped: Add your Adzuna app ID and key in Settings → Job search first. FreeHire was skipped: Add your FreeHire key in Settings → Job search first.",
    );
    expect(await runs()).toEqual([{ at: now.toISOString(), manual: false, message: result.message, requests: [] }]);
  });

  it("goes on with the others when a provider fails, and asks it no more", async () => {
    fake.respond = (source, search) => {
      if (source === "ADZUNA") throw jobSearchError("unavailable", source);
      return perRequest(source, search);
    };
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(fake.requests.filter(([source]) => source === "ADZUNA")).toHaveLength(1);
    expect(result).toMatchObject({ found: 5, scored: 5 });
    expect(result.message).toMatch(
      /^Searched 3 job types on FreeHire, and 2 on JSearch \(its limit of 2 a day\)\. Adzuna didn't answer: Adzuna isn't answering right now\. Try again in a minute\. /,
    );
    // Its planned requests still count against its cap.
    expect((await runs())[0].requests.filter((request) => request.source === "ADZUNA")).toHaveLength(3);
  });

  it("ends with the first provider's error when every one fails", async () => {
    fake.respond = (source) => {
      throw jobSearchError(source === "JSEARCH" ? "quota" : "unavailable", source);
    };
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toEqual({ found: 0, fresh: 0, scored: 0, drafted: 0, skipped: 0, message: "You've used up your JSearch searches for this month. Try again then, or move to a bigger plan." });
    expect((await runs())[0].message).toBe(result.message);
  });

  it("leaves JSearch out on Run now while its two a day are used", async () => {
    const earlier = new Date(now.getTime() - 2 * hour).toISOString();
    const used = [{ source: "JSEARCH" as const, searchId: "designer" }, { source: "JSEARCH" as const, searchId: "researcher" }];
    await saveSettings({ agentRuns: [{ at: earlier, manual: false, message: null, requests: used }] });
    const result = await runAgentScan({ manual: true }, context(), now);
    expect(fake.requests.map(([source]) => source)).not.toContain("JSEARCH");
    expect(result.message).toContain("Searched 3 job types on Adzuna and FreeHire. JSearch's limit of 2 a day is used up for today.");

    // With only JSearch on, there's nothing to do until its cap frees up, and the run is on record.
    fake.sourcesOn = ["JSEARCH"];
    fake.requests = [];
    const later = new Date(now.getTime() + 2 * hour);
    expect((await runAgentScan({ manual: true }, context(), later)).message).toBe("JSearch's limit of 2 a day is used up for today. Nothing to search until tomorrow.");
    expect(fake.requests).toEqual([]);
    expect((await runs())[0]).toMatchObject({ at: later.toISOString(), requests: [], message: "JSearch's limit of 2 a day is used up for today. Nothing to search until tomorrow." });
  });

  it("counts a provider's cap per calendar day in the user's time zone", async () => {
    // Yesterday's run at 07:12 in Amsterdam; today's starts a few minutes earlier in the day.
    const yesterday = { at: "2026-10-19T05:12:00Z", manual: false, message: null, requests: [{ source: "JSEARCH" as const, searchId: "designer" }, { source: "JSEARCH" as const, searchId: "researcher" }] };
    await saveSettings({ browserTimeZone: "Europe/Amsterdam", agentRuns: [yesterday] });
    const today = new Date("2026-10-20T05:05:00Z");
    await runAgentScan({ manual: false }, context(), today);
    expect(fake.requests.filter(([source]) => source === "JSEARCH")).toEqual([["JSEARCH", "Product designer"], ["JSEARCH", "UX writer"]]);

    // Run now later the same day finds today's two used.
    fake.sourcesOn = ["JSEARCH"];
    fake.requests = [];
    const later = new Date(today.getTime() + 3 * hour);
    expect((await runAgentScan({ manual: true }, context(), later)).message).toBe("JSearch's limit of 2 a day is used up for today. Nothing to search until tomorrow.");
    expect(fake.requests).toEqual([]);
  });

  it("sends a provider the search's query only, as Find jobs does, so the cache can answer", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    vi.mocked(searchPostings).mockClear();
    await runAgentScan({ manual: false }, context(), now);
    const sent = vi.mocked(searchPostings).mock.calls.map(([, , sentQuery]) => sentQuery);
    expect(sent).toHaveLength(8);
    expect(sent[0]).toStrictEqual(query);
    // In the schema's order too: the cache key is the query as JSON.
    for (const sentQuery of sent) expect(Object.keys(sentQuery)).toEqual(Object.keys(searchQuerySchema.shape));
  });

  it("asks no provider again once it's cancelled", async () => {
    const abort = new AbortController();
    fake.respond = (source, search) => {
      abort.abort();
      return perRequest(source, search);
    };
    const result = await runAgentScan({ manual: false }, context(abort), now);
    expect(fake.requests).toEqual([["JSEARCH", "Product designer"]]);
    expect(result.scored).toBe(0);
    expect(await prisma().agentCandidate.count()).toBe(0);
  });

  it("asks no provider when it's cancelled before the first request", async () => {
    const abort = new AbortController();
    const run = context(abort);
    run.step = async () => abort.abort();
    const result = await runAgentScan({ manual: false }, run, now);
    expect(fake.requests).toEqual([]);
    expect(result).toEqual({ found: 0, fresh: 0, scored: 0, drafted: 0, skipped: 0, message: "Cancelled." });
  });

  it("says so when no provider that's on can run the searches", async () => {
    await saveSettings({ agentSourceCaps: { JSEARCH: 0, ADZUNA: 0, FREEHIRE: 0 } });
    expect((await runAgentScan({ manual: false }, context(), now)).message).toBe("None of the providers that are on can run your saved searches.");
    expect(fake.requests).toEqual([]);
  });

  it("keeps a posting two searches found once, with the first search", async () => {
    fake.sourcesOn = ["FREEHIRE"];
    fake.respond = () => [posting("same", "Senior Product Designer", "2026-10-19T00:00:00Z", { source: "FREEHIRE" })];
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 3, fresh: 1, skipped: 2, scored: 1 });
    expect(await prisma().agentCandidate.findMany({ select: { externalId: true, searchId: true, searchName: true } })).toEqual([
      { externalId: "same", searchId: "designer", searchName: "Product designer" },
    ]);
  });

  it("shares the scores among the searches", async () => {
    await saveSettings({ agentMaxScores: 3 });
    fake.sourcesOn = ["FREEHIRE"];
    fake.respond = (source, search) => {
      const [first] = perRequest(source, search);
      return [first, { ...first, externalId: `${first.externalId}-2`, url: `${first.url}-2`, title: `${first.title} 2` }];
    };
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 6, fresh: 6, scored: 3 });
    expect((await prisma().agentCandidate.findMany({ select: { searchId: true } })).map(({ searchId }) => searchId).sort()).toEqual(["designer", "researcher", "writer"]);
  });
});
