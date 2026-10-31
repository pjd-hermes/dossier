import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { decryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";
import { loadSettings } from "@/lib/settings-data";
import { freehireLastPage } from "@/test/job-search-fixtures";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";

import { saveJobSource, saveJobSourceKey } from "./actions";
import { setJobSourceOn, testJobSourceOf } from "./provider-actions";

// The actions run against the test database, signed in.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  clearJobSearchCache();
});
afterAll(() => prisma().$disconnect());

describe("setJobSourceOn", () => {
  it("adds a provider to the ones that are on, starting from the saved choice", async () => {
    await saveJobSource({ source: "JSEARCH" });
    expect(await setJobSourceOn({ source: "FREEHIRE", on: true })).toMatchObject({ ok: true, data: { sourcesOn: ["JSEARCH", "FREEHIRE"], source: "JSEARCH" } });
    expect((await loadSettings()).jobSourcesOn).toEqual(["JSEARCH", "FREEHIRE"]);
  });

  it("turns a provider off without touching its key", async () => {
    await saveJobSourceKey({ source: "JSEARCH", change: { action: "set", value: "ak_secret" } });
    await setJobSourceOn({ source: "JSEARCH", on: true });
    await setJobSourceOn({ source: "FREEHIRE", on: true });
    const result = await setJobSourceOn({ source: "JSEARCH", on: false });
    expect(result).toMatchObject({ ok: true, data: { sourcesOn: ["FREEHIRE"], source: "FREEHIRE", jsearch: { keyState: "set" } } });
    expect(decryptSecret(JOB_SOURCE_KEY, (await loadSettings()).jsearchKeyEnc!)).toBe("ak_secret");
    expect(await setJobSourceOn({ source: "FREEHIRE", on: false })).toMatchObject({ ok: true, data: { sourcesOn: [], source: "OFF" } });
  });

  it("turns the Bundesagentur für Arbeit on only with its note accepted (#223)", async () => {
    expect(await setJobSourceOn({ source: "ARBEITSAGENTUR", on: true })).toEqual({
      ok: false,
      error: "Tick “I understand” under the note about the Bundesagentur für Arbeit first.",
    });
    expect((await loadSettings()).jobSourcesOn).toBeNull();
    const accepted = await setJobSourceOn({ source: "ARBEITSAGENTUR", on: true, accepted: true });
    expect(accepted).toMatchObject({ ok: true, data: { sourcesOn: ["ARBEITSAGENTUR"], arbeitsagentur: { acceptedAt: expect.any(String) } } });
    // Once accepted, turning it on again needs no second tick.
    await setJobSourceOn({ source: "ARBEITSAGENTUR", on: false });
    expect(await setJobSourceOn({ source: "ARBEITSAGENTUR", on: true })).toMatchObject({ ok: true, data: { sourcesOn: ["ARBEITSAGENTUR"] } });
  });

  it("refuses the Bundesagentur für Arbeit when the server doesn't offer it", async () => {
    const { env } = await import("@/lib/env");
    Object.assign(env, { DOSSIER_JOBS_ARBEITSAGENTUR: "off" });
    try {
      expect(await setJobSourceOn({ source: "ARBEITSAGENTUR", on: true, accepted: true })).toEqual({
        ok: false,
        error: "The Bundesagentur für Arbeit isn't offered on this server.",
      });
    } finally {
      delete (env as Record<string, unknown>).DOSSIER_JOBS_ARBEITSAGENTUR;
    }
  });
});

describe("testJobSourceOf", () => {
  it("tests the provider it's given, on or off", async () => {
    stubFetch(() => json(freehireLastPage));
    expect(await testJobSourceOf({ source: "FREEHIRE" })).toEqual({ ok: true, data: { connected: true, seconds: expect.any(Number) } });
    vi.unstubAllGlobals();
  });

  it("says what's missing", async () => {
    expect(await testJobSourceOf({ source: "JSEARCH" })).toEqual({
      ok: true,
      data: { connected: false, message: "Add your JSearch key in Settings → Job search first." },
    });
  });
});
