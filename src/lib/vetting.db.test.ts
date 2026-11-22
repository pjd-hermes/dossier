import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { postingStates } from "@/lib/postings";
import { createTestClient, resetDatabase } from "@/test/db";

import { dismissWithReason, recordVetting, restorePosting } from "./vetting";
import { vettingOf } from "./vetting-shape";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const make = (externalId: string, extra: Record<string, unknown> = {}) =>
  prisma().posting.create({
    data: { source: "JSEARCH", externalId, title: "Remote assistant", company: "Quick Cash LLC", place: "Anywhere", description: "Send us a fee first.", complete: true, ...extra },
  });

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("vetting what the job agent found (fork)", () => {
  it("records a verdict with who checked it and when", async () => {
    const row = await make("a");
    const result = await recordVetting(row.id, { verdict: "doubtful", note: "No website", checks: [{ name: "Company site", result: "None found" }] }, "n8n");
    expect(result).toEqual({ ok: true });
    const vetting = vettingOf((await prisma().posting.findUniqueOrThrow({ where: { id: row.id } })).vetting);
    expect(vetting).toMatchObject({ verdict: "doubtful", note: "No website", checks: [{ name: "Company site", result: "None found" }], checkedBy: "n8n" });
    expect(Date.parse(vetting!.checkedAt)).not.toBeNaN();
  });

  it("says so when the posting isn't there, was removed, or is shown as another one", async () => {
    expect(await recordVetting("nope", { verdict: "legit", note: "" }, "n8n")).toEqual({ ok: false, message: "That posting is no longer in Dossier." });
    const gone = await make("gone", { removedAt: new Date() });
    expect(await recordVetting(gone.id, { verdict: "legit", note: "" }, "n8n")).toMatchObject({ ok: false });
    const shown = await make("shown");
    const merged = await make("merged", { mergedIntoId: shown.id });
    expect(await recordVetting(merged.id, { verdict: "legit", note: "" }, "n8n")).toEqual({
      ok: false,
      message: `That posting is the same job as ${shown.id}, which is the one Dossier shows. Use that posting_id.`,
    });
  });

  it("reaches Positions with the posting's state, without its checks, and not at all without a verdict", async () => {
    const row = await make("a");
    const other = await make("b");
    await recordVetting(row.id, { verdict: "scam", note: "Asks for a fee", checks: [{ name: "Site", result: "none" }] }, "n8n");
    const states = await postingStates([
      { source: "JSEARCH", externalId: "a", url: "" },
      { source: "JSEARCH", externalId: "b", url: "" },
    ]);
    expect(states.get("JSEARCH:a")?.vetting).toEqual({ verdict: "scam", note: "Asks for a fee", checkedBy: "n8n" });
    expect(states.get("JSEARCH:b")).not.toHaveProperty("vetting");
    expect(other.id).toBeTruthy();
  });

  it("reads a stored value that doesn't fit as no verdict", () => {
    expect(vettingOf({ verdict: "maybe" })).toBeNull();
    expect(vettingOf(null)).toBeNull();
  });

  it("dismisses with a reason that survives the trimming, and takes the agent's candidate out of its queue", async () => {
    const row = await make("a");
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "a", dedupeKey: "a", status: "SCORED", description: "text" } });
    const result = await dismissWithReason(row.id, { reason: "Asks for a fee" }, "n8n");
    expect(result).toEqual({ ok: true, wasSaved: false });
    const after = await prisma().posting.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.dismissedAt).not.toBeNull();
    expect(after.description).toBe("");
    expect(vettingOf(after.vetting)).toMatchObject({ verdict: "scam", note: "Asks for a fee", checkedBy: "n8n" });
    expect((await prisma().agentCandidate.findFirstOrThrow()).status).toBe("DISMISSED");
  });

  it("can call it doubtful rather than a scam", async () => {
    const row = await make("a");
    await dismissWithReason(row.id, { reason: "Vague", verdict: "doubtful" }, "n8n");
    expect(vettingOf((await prisma().posting.findUniqueOrThrow({ where: { id: row.id } })).vetting)?.verdict).toBe("doubtful");
  });

  it("dismisses a posting once, and says so the second time without writing", async () => {
    const row = await make("a");
    await dismissWithReason(row.id, { reason: "First" }, "n8n");
    const first = await prisma().posting.findUniqueOrThrow({ where: { id: row.id } });
    expect(await dismissWithReason(row.id, { reason: "Second" }, "someone else")).toEqual({ ok: false, message: "That posting is dismissed already." });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ vetting: first.vetting, dismissedAt: first.dismissedAt });
  });

  it("refuses a posting shown as another one, and one that's not there", async () => {
    const shown = await make("shown");
    const merged = await make("merged", { mergedIntoId: shown.id });
    expect(await dismissWithReason(merged.id, { reason: "x" }, "n8n")).toMatchObject({ ok: false, message: expect.stringContaining(shown.id) });
    expect(await dismissWithReason("nope", { reason: "x" }, "n8n")).toEqual({ ok: false, message: "That posting is no longer in Dossier." });
    expect((await prisma().posting.findUniqueOrThrow({ where: { id: merged.id } })).dismissedAt).toBeNull();
  });

  it("restores a dismissed posting to the agent's queue and keeps what was found out", async () => {
    const row = await make("a");
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "a", dedupeKey: "a", status: "SCORED", description: "text" } });
    await dismissWithReason(row.id, { reason: "Asks for a fee" }, "n8n");
    expect(await restorePosting(row.id)).toEqual({ ok: true, restored: true });
    const after = await prisma().posting.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.dismissedAt).toBeNull();
    expect(vettingOf(after.vetting)?.note).toBe("Asks for a fee");
    expect((await prisma().agentCandidate.findFirstOrThrow()).status).toBe("SCORED");
  });

  it("restores nothing that isn't dismissed, and says when it isn't there", async () => {
    const row = await make("a");
    expect(await restorePosting(row.id)).toEqual({ ok: true, restored: false });
    expect(await restorePosting("nope")).toEqual({ ok: false, message: "That posting is no longer in Dossier." });
  });
});
