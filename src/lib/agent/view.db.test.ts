import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { countAgentQueue, loadAgentView } from "./view";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const providers = vi.hoisted(() => ({ on: ["JSEARCH"] as string[] }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ sourcesOn: providers.on, source: "JSEARCH", saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
}));

const prisma = () => db.client!;
const now = new Date("2026-10-20T10:00:00Z");
const candidate = (externalId: string, score: number, data: Record<string, unknown> = {}) =>
  prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId, dedupeKey: externalId, title: `Posting ${externalId}`, company: "Ledgerly", place: "Berlin", remote: true, score, via: "LinkedIn", postedAt: new Date("2026-10-18T00:00:00Z"), ...data } });

const savedSearch = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  keywords: name,
  place: "Berlin",
  country: "de",
  radiusKm: 25 as const,
  remoteOnly: false,
  postedWithin: "any" as const,
  enabled: true,
  ...extra,
});

beforeEach(async () => {
  providers.on = ["JSEARCH"];
  await resetDatabase(prisma());
  await saveSettings({
    agentEnabled: true,
    agentQuery: { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" },
    agentRuns: [{ at: "2026-10-20T05:00:00Z", manual: false, message: "2 new postings are waiting for a look.", requests: [] }],
  });
});
afterAll(() => prisma().$disconnect());

describe("the Agent screen's data (E16-6)", () => {
  it("splits the queue into drafts, scored postings and those below the minimum, best first", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    await candidate("draft", 90, { status: "DRAFTED", applicationId: application.id });
    const good = await candidate("good", 75);
    await candidate("better", 88);
    await candidate("low", 30);
    await candidate("gone", 95, { status: "DISMISSED" });
    await candidate("kept", 95, { status: "APPROVED" });
    const job = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${good.id}`, input: { candidateId: good.id } } });

    const view = await loadAgentView(now);
    expect(view.drafts.map((entry) => entry.title)).toEqual(["Posting draft"]);
    expect(view.scored.map((entry) => entry.title)).toEqual(["Posting better", "Posting good"]);
    expect(view.belowMinimum.map((entry) => entry.title)).toEqual(["Posting low"]);
    expect(view.scored[1]).toMatchObject({ facts: "Berlin · Remote", origin: "Posted 2 days ago · via LinkedIn on JSearch", draftJobId: job.id });
    expect(view).toMatchObject({
      searchSummary: "1 saved search on JSearch",
      filters: [],
      setupProblem: null,
      limitReached: false,
      lastRun: { at: "Tue 20 Oct, 07:00", message: "2 new postings are waiting for a look." },
      nextRun: "Wed 21 Oct, 07:00",
    });
    // The badge: scored at or above the minimum, and drafts.
    expect(await countAgentQueue()).toBe(3);
  });

  it("says what's missing, and when the day's runs are used up", async () => {
    await saveSettings({
      agentEnabled: false,
      agentQuery: { keywords: "", place: "", country: "", radiusKm: 25, remoteOnly: false, postedWithin: "any" },
      agentRuns: ["09:30", "08:00", "06:00"].map((time) => ({ at: `2026-10-20T${time}:00Z`, manual: true, message: null, requests: [] })),
    });
    expect(await loadAgentView(now)).toMatchObject({
      enabled: false,
      searchSummary: null,
      setupProblem: "Add a saved search in Settings → Job agent first.",
      setupSection: "agent",
      limitReached: true,
      nextRun: null,
    });
  });

  it("words the searches and the providers they run on", async () => {
    providers.on = ["JSEARCH", "ADZUNA", "FREEHIRE"];
    await saveSettings({ agentSearches: [savedSearch("a", "Designer"), savedSearch("b", "Writer"), savedSearch("c", "Editor"), savedSearch("d", "Paused", { enabled: false })] });
    expect((await loadAgentView(now)).searchSummary).toBe("3 saved searches on JSearch, Adzuna and FreeHire");
    providers.on = ["FREEHIRE", "ARBEITSAGENTUR"];
    await saveSettings({ agentSearches: [savedSearch("a", "Designer")] });
    expect((await loadAgentView(now)).searchSummary).toBe("1 saved search on FreeHire");
  });

  it("tags postings with their search, by its current name, and offers a filter once there are two", async () => {
    await saveSettings({ agentSearches: [savedSearch("a", "Product designer"), savedSearch("b", "Writer")] });
    await candidate("one", 80, { searchId: "a", searchName: "Designer" });
    await candidate("two", 75, { searchId: "a", searchName: "Designer" });
    await candidate("three", 30, { searchId: "b", searchName: "Writer" });
    await candidate("old", 90, { searchId: "gone", searchName: "Archivist" });
    await candidate("none", 50);
    const view = await loadAgentView(now);
    const byTitle = Object.fromEntries([...view.scored, ...view.belowMinimum].map((entry) => [entry.title, entry.search]));
    expect(byTitle).toEqual({
      "Posting one": { id: "a", name: "Product designer" },
      "Posting two": { id: "a", name: "Product designer" },
      "Posting three": { id: "b", name: "Writer" },
      "Posting old": { id: "gone", name: "Archivist" },
      "Posting none": null,
    });
    expect(view.filters).toEqual([
      { id: "a", name: "Product designer", count: 2 },
      { id: "b", name: "Writer", count: 1 },
      { id: "gone", name: "Archivist", count: 1 },
    ]);
  });

  it("offers no filter for one search", async () => {
    await saveSettings({ agentSearches: [savedSearch("a", "Designer")] });
    await candidate("one", 80, { searchId: "a", searchName: "Designer" });
    expect((await loadAgentView(now)).filters).toEqual([]);
  });
});
