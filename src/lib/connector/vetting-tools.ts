import "server-only";

import { type CallToolResult, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { companyHistory, listAgentFinds } from "@/lib/agent-finds";
import { dismissWithReason, recordVetting, restorePosting } from "@/lib/vetting";
import { checkSchema, VERDICTS } from "@/lib/vetting-shape";

import type { ConnectorAccess } from "./scopes";

// Fork: the tools for checking what the job agent found (see FORK.md). They
// read from the library and the agent's candidates, and dismiss and restore
// through postings.ts, as the screens do. A "read" token gets the two that
// only look; limitTools (scopes.ts) takes the others out for it.

const text = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

const postingId = z.string().min(1).max(100).describe("The posting's postingId, as list_agent_finds gives it");

export function registerVettingTools(server: McpServer, { linkTo, access }: { linkTo: (path: string) => string; access: ConnectorAccess }): void {
  server.registerTool(
    "list_agent_finds",
    {
      title: "List what the job agent found",
      description:
        "Postings the job agent's runs found, newest first, without those the user or a tool dismissed. Each has the company, salary, link, which portals found it, what the agent's scoring flagged (redFlags, requirements covered) and any verdict already recorded. " +
        "Use since to read only what's new after a run, and only_unvetted to skip what already has a verdict. Read the whole text of one with get_posting (posting_id), then record_vetting or dismiss_posting.",
      inputSchema: z.object({
        since: z.string().max(40).optional().describe("Only postings a search found at or after this time, e.g. 2026-11-22T06:00:00Z"),
        agent_search: z.string().max(200).optional().describe("Only what one agent search found, by name or id"),
        only_unvetted: z.boolean().optional().describe("Leave out postings that already have a verdict"),
        limit: z.number().int().min(1).max(100).optional().describe("How many to return; 30 when left out"),
        cursor: z.string().max(500).optional().describe("The next value of an earlier answer, for the next page"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ since, agent_search, only_unvetted, limit, cursor }) => {
      const from = since ? new Date(since) : undefined;
      if (from && Number.isNaN(from.getTime())) return failure("since isn't a date. Use a form like 2026-11-22T06:00:00Z.");
      const result = await listAgentFinds({ since: from, agentSearch: agent_search, onlyUnvetted: only_unvetted, limit, cursor });
      if ("error" in result) return failure(result.error);
      return text({ finds: result.finds, next: result.next, more_available: result.next !== null, link: linkTo("/jobs") });
    },
  );

  server.registerTool(
    "company_history",
    {
      title: "What Dossier knows about a company",
      description:
        "Other postings from the same company that Dossier has found (and which were dismissed or marked a scam), and how many applications the user has made to it. " +
        "A company that keeps reposting, or that already had a scam, is worth a closer look. Give a posting_id, or the company's name.",
      inputSchema: z.object({ posting_id: postingId.optional(), company: z.string().max(200).optional().describe("The company's name, when there is no posting") }),
      annotations: { readOnlyHint: true },
    },
    async ({ posting_id, company }) => {
      const result = await companyHistory({ postingId: posting_id, company });
      return "error" in result ? failure(result.error) : text(result);
    },
  );

  server.registerTool(
    "record_vetting",
    {
      title: "Record whether a posting looks real",
      description:
        "Saves what you found out about a posting: legit, doubtful or scam, a short note, and the checks you made (what you looked at and what you saw, e.g. the company's website, the salary against the market). Shown with the posting in Positions. " +
        "It doesn't dismiss anything: use dismiss_posting for a scam. Recording again replaces the earlier verdict.",
      inputSchema: z.object({
        posting_id: postingId,
        verdict: z.enum(VERDICTS).describe("legit: a real posting from a real company. doubtful: something's off but not proven. scam: not a real job, or one that asks for money or private details."),
        note: z.string().max(1000).describe("Why, in a sentence or two"),
        checks: z.array(checkSchema).max(20).optional(),
      }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ posting_id, verdict, note, checks }) => {
      const result = await recordVetting(posting_id, { verdict, note, checks }, access.name);
      return result.ok ? text({ posting_id, verdict, recorded: true }) : failure(result.message);
    },
  );

  server.registerTool(
    "dismiss_posting",
    {
      title: "Dismiss a posting",
      description:
        "Dismisses a posting the user wouldn't want, such as a scam or a not-so-legitimate company: it stays out of Dossier's lists and later searches, and the job agent drops it from its queue. " +
        "Give the reason, which is kept with the posting as its verdict (scam unless you say doubtful). restore_posting undoes it. Nothing is deleted.",
      inputSchema: z.object({
        posting_id: postingId,
        reason: z.string().trim().min(1).max(300).describe("Why, in a sentence"),
        verdict: z.enum(["doubtful", "scam"]).optional().describe("scam when left out"),
      }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ posting_id, reason, verdict }) => {
      const result = await dismissWithReason(posting_id, { reason, verdict }, access.name);
      return result.ok ? text({ posting_id, dismissed: true }) : failure(result.message);
    },
  );

  server.registerTool(
    "restore_posting",
    {
      title: "Restore a dismissed posting",
      description: "Undoes dismiss_posting: the posting is back in Dossier's lists and the job agent's queue. The verdict recorded with it stays.",
      inputSchema: z.object({ posting_id: postingId }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ posting_id }) => {
      const result = await restorePosting(posting_id);
      return result.ok ? text({ posting_id, restored: result.restored }) : failure(result.message);
    },
  );
}
