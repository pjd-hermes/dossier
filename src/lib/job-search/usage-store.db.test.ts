import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { logServerError } from "@/lib/log";
import * as settingsData from "@/lib/settings-data";
import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { countRequest } from "./usage-store";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const prisma = () => db.client!;
const now = new Date("2026-10-31T12:00:00Z");

beforeEach(async () => {
  vi.mocked(logServerError).mockClear();
  await resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("countRequest", () => {
  it("counts today's requests for each provider", async () => {
    await countRequest("JSEARCH", now);
    await countRequest("JSEARCH", now);
    await countRequest("ADZUNA", now);
    expect((await loadSettings()).jobSourceUsage).toEqual({ JSEARCH: { "2026-10-31": 2 }, ADZUNA: { "2026-10-31": 1 } });
  });

  it("drops days older than 31 days as it goes", async () => {
    await settingsData.saveSettings({ jobSourceUsage: { JSEARCH: { "2026-09-01": 9 } } });
    await countRequest("JSEARCH", now);
    expect((await loadSettings()).jobSourceUsage).toEqual({ JSEARCH: { "2026-10-31": 1 } });
  });

  it("never throws: a failure is logged", async () => {
    const failure = new Error("database is down");
    vi.spyOn(settingsData, "saveSettings").mockRejectedValueOnce(failure);
    await expect(countRequest("JSEARCH", now)).resolves.toBeUndefined();
    expect(logServerError).toHaveBeenCalledWith("job search usage", failure);
  });
});
