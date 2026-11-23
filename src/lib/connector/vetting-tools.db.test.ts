import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { createToken, type TokenScope } from "./tokens";

// The tools for what the job agent found (fork), called as n8n and Claude call
// them, through /api/mcp, with a named access token.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_PASSWORD: "argon2id:m=19456,t=2,p=1:c2FsdA:aGFzaA" } }));

import { POST } from "@/app/api/mcp/route";

const prisma = () => db.client!;
const NEW_TOOLS = ["company_history", "dismiss_posting", "list_agent_finds", "record_vetting", "restore_posting"];

async function tokenFor(scope: TokenScope, name = "n8n") {
  return (await createToken({ name, scope })).token;
}

async function rpc(token: string, method: string, params?: unknown) {
  const response = await POST(
    new Request("https://dossier.example/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const body = await response.text();
  return JSON.parse(body.trimStart().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: { message: string } };
}

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const { result, error } = await rpc(token, "tools/call", { name, arguments: args });
  if (!result) return { isError: true, text: error?.message ?? "", json: null as unknown as Record<string, unknown> };
  const text = result.content?.[0]?.text ?? "";
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A plain message.
  }
  return { isError: result.isError ?? false, text, json: json as Record<string, unknown> };
}

async function agentFind(externalId: string, company = "Quick Cash GmbH") {
  const search = await prisma().postingSearch.create({ data: { query: {}, agentSearchName: "Berlin designer" } });
  const posting = await prisma().posting.create({
    data: { source: "JSEARCH", externalId, title: `Job ${externalId}`, company, matchCompany: "quick cash", description: "Pay a fee first.", complete: true },
  });
  await prisma().postingFind.create({ data: { postingId: posting.id, searchId: search.id, portal: "JSEARCH" } });
  await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId, dedupeKey: externalId, status: "SCORED", description: "x", redFlags: ["Asks for money"] } });
  return posting;
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await saveSettings({ connectorEnabledAt: "2026-10-23T09:00:00.000Z" });
});
afterAll(() => prisma().$disconnect());

describe("the tools for what the job agent found (fork)", () => {
  it("lists what the agent found, vets it, dismisses a scam and restores it, with the token's name on the verdict", async () => {
    const posting = await agentFind("a");
    const token = await tokenFor("dismiss");

    const listed = await tool(token, "list_agent_finds", {});
    expect(listed.json).toMatchObject({ more_available: false, finds: [{ postingId: posting.id, title: "Job a", company: "Quick Cash GmbH", redFlags: ["Asks for money"], vetting: null }] });

    const history = await tool(token, "company_history", { posting_id: posting.id });
    expect(history.json).toMatchObject({ company: "Quick Cash GmbH", applications: 0, scamsVetted: 0 });

    const recorded = await tool(token, "record_vetting", { posting_id: posting.id, verdict: "doubtful", note: "No website", checks: [{ name: "Company site", result: "none" }] });
    expect(recorded).toMatchObject({ isError: false, json: { posting_id: posting.id, verdict: "doubtful" } });
    expect((await tool(token, "list_agent_finds", { only_unvetted: true })).json).toMatchObject({ finds: [] });

    const dismissed = await tool(token, "dismiss_posting", { posting_id: posting.id, reason: "Asks for a fee" });
    expect(dismissed).toMatchObject({ isError: false, json: { posting_id: posting.id, dismissed: true } });
    expect((await tool(token, "list_agent_finds", {})).json).toMatchObject({ finds: [] });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ vetting: { verdict: "scam", note: "Asks for a fee", checkedBy: "n8n" } });

    expect(await tool(token, "restore_posting", { posting_id: posting.id })).toMatchObject({ isError: false, json: { restored: true } });
    expect((await tool(token, "list_agent_finds", {})).json).toMatchObject({ finds: [{ postingId: posting.id, vetting: { verdict: "scam" } }] });
  });

  it("records whether it was posted directly or by a recruiter, with the direct link", async () => {
    const posting = await agentFind("a", "Acme");
    const token = await tokenFor("dismiss");
    const recorded = await tool(token, "record_vetting", { posting_id: posting.id, verdict: "legit", note: "Agency ad", source: "recruiter", direct_url: "https://acme.example/jobs/1" });
    expect(recorded).toMatchObject({ isError: false, json: { posting_id: posting.id, verdict: "legit", source: "recruiter" } });
    expect((await tool(token, "list_agent_finds", {})).json).toMatchObject({
      finds: [{ postingId: posting.id, vetting: { verdict: "legit", source: "recruiter", directUrl: "https://acme.example/jobs/1" } }],
    });
    // Recorded again without them: a plain verdict says nothing about the source.
    await tool(token, "record_vetting", { posting_id: posting.id, verdict: "legit", note: "Checked" });
    expect((await tool(token, "list_agent_finds", {})).json).toMatchObject({ finds: [{ vetting: { source: "unknown" } }] });
  });

  it("refuses a direct link that isn't a web address, or is too long, as the caller's mistake", async () => {
    const posting = await agentFind("a");
    const token = await tokenFor("dismiss");
    for (const direct_url of ["ftp://acme.example/jobs/1", "javascript:alert(1)", `https://acme.example/${"a".repeat(500)}`]) {
      expect((await tool(token, "record_vetting", { posting_id: posting.id, verdict: "legit", note: "x", source: "recruiter", direct_url })).isError).toBe(true);
    }
    expect((await tool(token, "record_vetting", { posting_id: posting.id, verdict: "legit", note: "x", source: "agency" })).isError).toBe(true);
    expect((await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).vetting).toBeNull();
  });

  it("explains a refusal in words, and treats a bad verdict or a missing reason as the caller's mistake", async () => {
    const token = await tokenFor("dismiss");
    expect(await tool(token, "dismiss_posting", { posting_id: "nope", reason: "x" })).toMatchObject({ isError: true, text: "That posting is no longer in Dossier." });
    expect((await tool(token, "record_vetting", { posting_id: "x", verdict: "fine", note: "" })).isError).toBe(true);
    expect((await tool(token, "dismiss_posting", { posting_id: "x" })).isError).toBe(true);
    expect(await tool(token, "list_agent_finds", { since: "not a date" })).toMatchObject({ isError: true });
    expect(await tool(token, "list_agent_finds", { agent_search: "Nobody" })).toMatchObject({ isError: true, text: expect.stringContaining("No agent search") });
  });

  it("gives a read token the two tools that only look", async () => {
    const posting = await agentFind("a");
    const token = await tokenFor("read");
    const { result } = await rpc(token, "tools/list");
    expect(result?.tools?.map((entry) => entry.name).filter((name) => NEW_TOOLS.includes(name)).sort()).toEqual(["company_history", "list_agent_finds"]);
    expect((await tool(token, "list_agent_finds")).json).toMatchObject({ finds: [{ postingId: posting.id }] });
    for (const name of ["dismiss_posting", "restore_posting", "record_vetting"]) {
      expect((await tool(token, name, { posting_id: posting.id, reason: "x", verdict: "scam", note: "x" })).isError).toBe(true);
    }
    expect((await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).dismissedAt).toBeNull();
  });

  it("gives a dismiss token those three and no application tool", async () => {
    const { result } = await rpc(await tokenFor("dismiss"), "tools/list");
    const names = result?.tools?.map((entry) => entry.name) ?? [];
    expect(NEW_TOOLS.every((name) => names.includes(name))).toBe(true);
    expect(names).not.toContain("save_application");
    expect(names).not.toContain("set_application_status");
    expect(names).not.toContain("search_jobs");
    expect(names).not.toContain("draft_application");
  });

  it("gives a draft token what a dismiss token has and Dossier's own drafting, and no other application tool", async () => {
    const names = ((await rpc(await tokenFor("draft"), "tools/list")).result?.tools ?? []).map((entry) => entry.name);
    expect(NEW_TOOLS.every((name) => names.includes(name))).toBe(true);
    expect(names).toEqual(expect.arrayContaining(["draft_application", "check_draft", "get_application", "get_posting", "list_applications"]));
    for (const name of ["save_application", "update_application", "set_application_status", "search_jobs", "more_jobs", "save_job_scores"]) expect(names).not.toContain(name);
  });

  it("answers a dismiss or read token that calls draft_application as it does any unknown tool", async () => {
    for (const scope of ["read", "dismiss"] as const) {
      const token = await tokenFor(scope, `app ${scope}`);
      const called = await tool(token, "draft_application", { posting_text: "A job." });
      expect(called.isError).toBe(true);
      expect(called.text.toLowerCase()).toContain("not found");
    }
    expect(await prisma().job.count()).toBe(0);
  });

  it("gives Claude's own sign-in every tool, with 'Claude' on a verdict", async () => {
    const { registerClient, issueCode, exchangeCode, challengeOf } = await import("./oauth");
    const callback = "https://claude.ai/api/mcp/auth_callback";
    const clientId = await registerClient({ name: "Claude", redirectUris: [callback] });
    const verifier = "v".repeat(50);
    const code = await issueCode({ clientId, redirectUri: callback, codeChallenge: challengeOf(verifier), resource: "" });
    const claude = (await exchangeCode({ code, clientId, redirectUri: callback, verifier })).access_token;
    const posting = await agentFind("a");
    expect((await rpc(claude, "tools/list")).result?.tools).toHaveLength(17);
    await tool(claude, "record_vetting", { posting_id: posting.id, verdict: "legit", note: "Real company" });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ vetting: { checkedBy: "Claude" } });
  });
});
