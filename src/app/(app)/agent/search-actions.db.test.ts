import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { saveAgentSettings } from "./actions";
import { addAgentSearch, removeAgentSearch, saveSourceCap, updateAgentSearch } from "./search-actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prisma = () => db.client!;
const ready = { ...EMPTY_QUERY, keywords: "Data scientist", country: "de" };
const legacy = { ...ready, id: "legacy", name: "Data scientist", enabled: true };

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("saved searches (Settings → Job agent)", () => {
  it("adds a paused, empty search, keeping the legacy search first under its id", async () => {
    await saveSettings({ agentQuery: ready });
    const added = await addAgentSearch({});
    expect(added).toMatchObject({ ok: true, data: { ...EMPTY_QUERY, name: "New search", enabled: false } });
    const { agentSearches } = await loadSettings();
    expect(agentSearches).toEqual([legacy, (added as { data: unknown }).data]);
  });

  it("keeps up to 5 searches", async () => {
    for (let count = 0; count < 5; count++) expect(await addAgentSearch({})).toMatchObject({ ok: true });
    expect(await addAgentSearch({})).toEqual({ ok: false, error: "You can keep up to 5 saved searches. Remove one first." });
    expect((await loadSettings()).agentSearches).toHaveLength(5);
  });

  it("changes a search, and turns it on only once it has keywords and a country", async () => {
    const added = await addAgentSearch({});
    const id = (added as { data: { id: string } }).data.id;
    expect(await updateAgentSearch({ id, changes: { enabled: true } })).toEqual({
      ok: false,
      error: "Add what to look for and a country before turning this search on.",
    });
    expect(await updateAgentSearch({ id, changes: { name: "Analyst", keywords: "Analyst" } })).toMatchObject({ ok: true, data: { id, name: "Analyst", keywords: "Analyst", enabled: false } });
    expect(await updateAgentSearch({ id, changes: { enabled: true } })).toMatchObject({ ok: false });
    expect(await updateAgentSearch({ id, changes: { country: "nl", enabled: true } })).toMatchObject({ ok: true, data: { enabled: true, country: "nl" } });
    expect((await loadSettings()).agentSearches).toEqual([expect.objectContaining({ id, keywords: "Analyst", country: "nl", enabled: true })]);
    // Pausing never needs a ready search.
    expect(await updateAgentSearch({ id, changes: { keywords: "", enabled: false } })).toMatchObject({ ok: true, data: { enabled: false } });
  });

  it("says when the search was removed meanwhile", async () => {
    expect(await updateAgentSearch({ id: "gone", changes: { name: "x" } })).toEqual({ ok: false, error: "That search was removed." });
  });

  it("removes a search, even the legacy one, and says where its postings are", async () => {
    await saveSettings({ agentQuery: ready });
    const result = await removeAgentSearch({ id: "legacy" });
    expect(result).toEqual({ ok: true, data: null, toast: "Search removed. Postings it found stay on the Agent screen." });
    expect((await loadSettings()).agentSearches).toEqual([]);
    // Without the saved list the legacy search would be back.
    expect((await loadSettings()).agentSearches).not.toBeNull();
  });

  it("saves a provider's cap next to the others", async () => {
    expect(await saveSourceCap({ source: "ADZUNA", cap: 3 })).toEqual({ ok: true, data: null });
    expect(await saveSourceCap({ source: "FREEHIRE", cap: "all" })).toEqual({ ok: true, data: null });
    expect((await loadSettings()).agentSourceCaps).toEqual({ JSEARCH: 2, ADZUNA: 3, FREEHIRE: "all" });
    expect(await saveSourceCap({ source: "JSEARCH", cap: 0 })).toEqual({ ok: true, data: null });
    expect((await loadSettings()).agentSourceCaps).toMatchObject({ JSEARCH: 0 });
    expect(await saveSourceCap({ source: "ARBEITSAGENTUR" as "ADZUNA", cap: 1 })).toMatchObject({ ok: false });
    expect(await saveSourceCap({ source: "ADZUNA", cap: 9 as 5 })).toMatchObject({ ok: false });
  });

  it("turns the agent on only with a search that is on", async () => {
    const message = "Add a saved search and turn it on before turning the agent on.";
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error: message });
    const added = await addAgentSearch({});
    const id = (added as { data: { id: string } }).data.id;
    await updateAgentSearch({ id, changes: { keywords: "Analyst", country: "nl" } });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error: message });
    await updateAgentSearch({ id, changes: { enabled: true } });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: true, data: null });
  });
});
