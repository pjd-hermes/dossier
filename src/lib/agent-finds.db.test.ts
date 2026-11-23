import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { companyHistory, listAgentFinds } from "./agent-finds";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 22, 12, minutes));
const vetted = { verdict: "legit", note: "", checks: [], checkedBy: "n8n", checkedAt: "2026-11-22T12:00:00.000Z" };

async function agentSearch(name: string) {
  return prisma().agentSearch.create({ data: { name, query: { keywords: name } } });
}
/** A run of an agent search (or a user's search when `agent` is null), and a posting it found. */
async function find(externalId: string, options: { agent?: { id: string; name: string } | null; minutes?: number; company?: string; posting?: Record<string, unknown>; searchId?: string } = {}) {
  const agent = options.agent === undefined ? { id: "", name: "Agent" } : options.agent;
  const search =
    options.searchId
      ? await prisma().postingSearch.findUniqueOrThrow({ where: { id: options.searchId } })
      : await prisma().postingSearch.create({
          data: { query: {}, agentSearchId: agent?.id || null, agentSearchName: agent ? agent.name : null },
        });
  const posting = await prisma().posting.create({
    data: {
      source: "JSEARCH",
      externalId,
      title: `Job ${externalId}`,
      company: options.company ?? "Acme GmbH",
      matchCompany: (options.company ?? "Acme GmbH").toLowerCase().replace(/ gmbh$/, ""),
      salary: "50k",
      lastFoundAt: at(options.minutes ?? 0),
      ...options.posting,
    },
  });
  await prisma().postingFind.create({ data: { postingId: posting.id, searchId: search.id, portal: "JSEARCH", foundAt: at(options.minutes ?? 0) } });
  return { posting, search };
}

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("what the job agent found (fork)", () => {
  it("lists what agent runs found, newest first, and not what the user's own searches found", async () => {
    await find("old", { minutes: 1 });
    await find("new", { minutes: 5 });
    await find("mine", { agent: null, minutes: 9 });
    const result = await listAgentFinds({});
    expect("finds" in result && result.finds.map((entry) => entry.title)).toEqual(["Job new", "Job old"]);
  });

  it("says which finds already have an application, so a workflow doesn't draft them again", async () => {
    const application = await prisma().application.create({ data: { title: "Applied" } });
    await find("applied", { minutes: 2, posting: { applicationId: application.id } });
    await find("open", { minutes: 1 });
    const result = await listAgentFinds({});
    expect("finds" in result && result.finds.map((entry) => [entry.title, entry.applicationId])).toEqual([
      ["Job applied", application.id],
      ["Job open", null],
    ]);
  });

  it("leaves out dismissed, removed and merged postings", async () => {
    const shown = await find("shown", { minutes: 1 });
    await find("dismissed", { posting: { dismissedAt: at(2) } });
    await find("removed", { posting: { removedAt: at(2) } });
    await find("merged", { posting: { mergedIntoId: shown.posting.id } });
    const result = await listAgentFinds({});
    expect("finds" in result && result.finds.map((entry) => entry.title)).toEqual(["Job shown"]);
  });

  it("filters by when it was found, and by what has no verdict yet", async () => {
    await find("early", { minutes: 1 });
    await find("late", { minutes: 30 });
    await find("checked", { minutes: 31, posting: { vetting: vetted } });
    expect(await titles({ since: at(10) })).toEqual(["Job checked", "Job late"]);
    expect(await titles({ onlyUnvetted: true })).toEqual(["Job late", "Job early"]);
  });

  it("filters by the agent search, by name or id, and says when there is no such one", async () => {
    const one = await agentSearch("Designer in Berlin");
    const two = await agentSearch("Researcher");
    await find("a", { agent: { id: one.id, name: one.name }, minutes: 1 });
    await find("b", { agent: { id: two.id, name: two.name }, minutes: 2 });
    expect(await titles({ agentSearch: "designer in berlin" })).toEqual(["Job a"]);
    expect(await titles({ agentSearch: two.id })).toEqual(["Job b"]);
    expect(await listAgentFinds({ agentSearch: "Nobody" })).toEqual({ error: expect.stringContaining("No agent search") });
  });

  it("keeps a find whose agent search was deleted, with the name it had", async () => {
    await find("a", { agent: { id: "", name: "Renamed or deleted" } });
    const result = await listAgentFinds({});
    expect("finds" in result && result.finds[0]).toMatchObject({ agentSearch: "Renamed or deleted" });
  });

  it("brings the agent's own judgement along when it scored the posting", async () => {
    await find("a", { minutes: 1 });
    await prisma().agentCandidate.create({
      data: { source: "JSEARCH", externalId: "a", dedupeKey: "a", redFlags: ["Asks for money"], covered: 3, requirements: 5, mustMissing: 1, skipReason: null },
    });
    const result = await listAgentFinds({});
    expect("finds" in result && result.finds[0]).toMatchObject({ portals: ["JSEARCH"], salary: "50k", redFlags: ["Asks for money"], covered: 3, requirements: 5, mustMissing: 1 });
  });

  it("pages through every find exactly once, in a stable order, and clamps the page size", async () => {
    for (let n = 0; n < 5; n++) await find(`p${n}`, { minutes: n % 2 });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await listAgentFinds({ limit: 2, cursor });
      if (!("finds" in result)) throw new Error(result.error);
      seen.push(...result.finds.map((entry) => entry.postingId));
      if (!result.next) break;
      cursor = result.next;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const huge = await listAgentFinds({ limit: 500 });
    expect("finds" in huge && huge.finds).toHaveLength(5);
  });

  it("lists a posting once even when several runs found it", async () => {
    const first = await find("a", { minutes: 1 });
    const second = await prisma().postingSearch.create({ data: { query: {}, agentSearchName: "Agent" } });
    await prisma().postingFind.create({ data: { postingId: first.posting.id, searchId: second.id, portal: "ADZUNA", foundAt: at(9) } });
    const result = await listAgentFinds({});
    expect("finds" in result && result.finds).toHaveLength(1);
    expect("finds" in result && result.finds[0]!.portals.sort()).toEqual(["ADZUNA", "JSEARCH"]);
  });

  it("answers an empty database with nothing", async () => {
    expect(await listAgentFinds({})).toEqual({ finds: [], next: null });
  });

  async function titles(options: Parameters<typeof listAgentFinds>[0]) {
    const result = await listAgentFinds(options);
    if (!("finds" in result)) throw new Error(result.error);
    return result.finds.map((entry) => entry.title);
  }
});

describe("what Dossier knows about a company (fork)", () => {
  it("lists the company's other postings, its applications and the scams already found", async () => {
    const mine = await find("a", { company: "Quick Cash GmbH", minutes: 1 });
    await find("b", { company: "Quick Cash", minutes: 5, posting: { dismissedAt: at(6), vetting: { ...vetted, verdict: "scam" } } });
    await find("c", { company: "Other Co", minutes: 2 });
    await prisma().application.create({ data: { title: "Role", company: "quick cash" } });
    const result = await companyHistory({ postingId: mine.posting.id });
    expect(result).toMatchObject({ company: "Quick Cash GmbH", applications: 1, scamsVetted: 1 });
    expect("postings" in result && result.postings.map((entry) => [entry.title, entry.dismissed])).toEqual([
      ["Job b", true],
      ["Job a", false],
    ]);
  });

  it("takes a company's name instead of a posting", async () => {
    await find("a", { company: "Acme GmbH" });
    expect(await companyHistory({ company: "acme" })).toMatchObject({ postings: [expect.objectContaining({ title: "Job a" })] });
  });

  it("never matches every posting without a company", async () => {
    await find("a", { company: "" });
    await find("b", { company: "" });
    expect(await companyHistory({ company: "  " })).toEqual({ error: "Give the company's name, or a posting that has one." });
    const nameless = await prisma().posting.findFirstOrThrow({ where: { externalId: "a" } });
    expect(await companyHistory({ postingId: nameless.id })).toEqual({ error: "Give the company's name, or a posting that has one." });
  });

  it("says when the posting isn't there", async () => {
    expect(await companyHistory({ postingId: "nope" })).toEqual({ error: "That posting is no longer in Dossier." });
  });
});
