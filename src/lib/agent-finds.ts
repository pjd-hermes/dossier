import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { stringsOf } from "@/lib/agent/candidates";
import { companyKey } from "@/lib/dedupe";
import { prisma } from "@/lib/prisma";

import { type Vetting, vettingOf } from "./vetting";

// Fork: what the job agent's runs found, and what Dossier knows about a
// company, for the MCP tools (connector/vetting-tools.ts) that n8n and Claude
// use to check postings. Reads from the library (Posting, PostingFind), where
// every run's finds are kept (E22-8), and from the agent's candidates for its
// own judgement; nothing is stored a second time.

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export type AgentFind = {
  postingId: string;
  title: string;
  company: string;
  place: string;
  remote: boolean | null;
  salary: string;
  url: string;
  via: string;
  /** The portals that found it. */
  portals: string[];
  /** When a search last found it. */
  foundAt: string;
  /** The agent search that found it last, by the name it had. */
  agentSearch: string | null;
  vetting: Vetting | null;
  redFlags: string[];
  covered: number;
  requirements: number;
  mustMissing: number;
  skipReason: string | null;
};

type Cursor = { at: string; id: string };
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decode(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as Partial<Cursor>;
    return typeof parsed.at === "string" && typeof parsed.id === "string" && !Number.isNaN(Date.parse(parsed.at)) ? { at: parsed.at, id: parsed.id } : null;
  } catch {
    return null;
  }
}

/**
 * What agent runs found, newest found first, without what was dismissed,
 * removed from the Archive or merged into another posting. A posting that
 * several runs found is listed once, with every portal.
 */
export async function listAgentFinds(options: {
  since?: Date;
  agentSearch?: string;
  onlyUnvetted?: boolean;
  limit?: number;
  cursor?: string;
}): Promise<{ finds: AgentFind[]; next: string | null } | { error: string }> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  // By id or name, the name in any case: SQLite can't compare case-insensitively in a query, and there are only a few.
  let searchIds: string[] | null = null;
  if (options.agentSearch) {
    const wanted = options.agentSearch.trim().toLowerCase();
    const named = (await prisma.agentSearch.findMany({ select: { id: true, name: true } })).filter((search) => search.id === options.agentSearch || search.name.toLowerCase() === wanted);
    if (named.length === 0) return { error: `No agent search is called "${options.agentSearch}". Use a name or id from Dossier's Agent screen.` };
    searchIds = named.map((search) => search.id);
  }
  const cursor = decode(options.cursor);
  if (options.cursor && !cursor) return { error: "That cursor isn't one Dossier gave. Start again without it." };

  const agentRun: Prisma.PostingSearchWhereInput = { agentSearchName: { not: null }, ...(searchIds ? { agentSearchId: { in: searchIds } } : {}) };
  const where: Prisma.PostingWhereInput = {
    dismissedAt: null,
    removedAt: null,
    mergedIntoId: null,
    finds: { some: { search: agentRun } },
    ...(options.since ? { lastFoundAt: { gte: options.since } } : {}),
    ...(options.onlyUnvetted ? { vetting: { equals: Prisma.DbNull } } : {}),
    ...(cursor ? { OR: [{ lastFoundAt: { lt: new Date(cursor.at) } }, { lastFoundAt: new Date(cursor.at), id: { gt: cursor.id } }] } : {}),
  };
  const rows = await prisma.posting.findMany({
    where,
    orderBy: [{ lastFoundAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    include: { finds: { where: { search: agentRun }, orderBy: { foundAt: "desc" }, include: { search: { select: { agentSearchName: true } } } } },
  });
  const page = rows.slice(0, limit);
  const candidates = page.length
    ? await prisma.agentCandidate.findMany({
        where: { OR: page.map((row) => ({ source: row.source, externalId: row.externalId })) },
        select: { source: true, externalId: true, redFlags: true, covered: true, requirements: true, mustMissing: true, skipReason: true },
      })
    : [];
  const candidateOf = new Map(candidates.map((candidate) => [`${candidate.source}\n${candidate.externalId}`, candidate]));
  const finds = page.map((row): AgentFind => {
    const candidate = candidateOf.get(`${row.source}\n${row.externalId}`);
    return {
      postingId: row.id,
      title: row.title,
      company: row.company,
      place: row.place,
      remote: row.remote,
      salary: row.salary,
      url: row.url,
      via: row.via,
      portals: [...new Set(row.finds.map((found) => found.portal))],
      foundAt: row.lastFoundAt.toISOString(),
      agentSearch: row.finds[0]?.search.agentSearchName ?? null,
      vetting: vettingOf(row.vetting),
      redFlags: candidate ? stringsOf(candidate.redFlags) : [],
      covered: candidate?.covered ?? 0,
      requirements: candidate?.requirements ?? 0,
      mustMissing: candidate?.mustMissing ?? 0,
      skipReason: candidate?.skipReason ?? null,
    };
  });
  const last = page.at(-1);
  return { finds, next: rows.length > limit && last ? encode({ at: last.lastFoundAt.toISOString(), id: last.id }) : null };
}

export type CompanyHistory = {
  company: string;
  /** Other postings from it, newest found first (up to 50), without those merged into another. */
  postings: { postingId: string; title: string; place: string; salary: string; firstFound: string; lastFound: string; dismissed: boolean; vetting: Vetting | null }[];
  /** Applications the user has made to it. */
  applications: number;
  /** How many of those postings were marked a scam. */
  scamsVetted: number;
};

/** What Dossier already has on a company, by a posting or by name; its legal form and punctuation don't matter (companyKey). */
export async function companyHistory(input: { postingId?: string; company?: string }): Promise<CompanyHistory | { error: string }> {
  let company = input.company?.trim() ?? "";
  if (input.postingId) {
    const row = await prisma.posting.findUnique({ where: { id: input.postingId }, select: { company: true } });
    if (!row) return { error: "That posting is no longer in Dossier." };
    company = row.company.trim();
  }
  const key = companyKey(company);
  if (!key) return { error: "Give the company's name, or a posting that has one." };
  const rows = await prisma.posting.findMany({ where: { matchCompany: key, removedAt: null, mergedIntoId: null }, orderBy: [{ lastFoundAt: "desc" }, { id: "asc" }], take: 50 });
  // Case-insensitive matching isn't available in SQLite queries, and an application's company is free text: compare the keys here.
  const applications = (await prisma.application.findMany({ select: { company: true } })).filter((application) => companyKey(application.company) === key).length;
  const postings = rows.map((row) => ({
    postingId: row.id,
    title: row.title,
    place: row.place,
    salary: row.salary,
    firstFound: row.createdAt.toISOString(),
    lastFound: row.lastFoundAt.toISOString(),
    dismissed: row.dismissedAt !== null,
    vetting: vettingOf(row.vetting),
  }));
  return { company, postings, applications, scamsVetted: postings.filter((posting) => posting.vetting?.verdict === "scam").length };
}
