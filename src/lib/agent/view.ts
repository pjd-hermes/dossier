import "server-only";

import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { agentSources } from "@/lib/job-search/providers-on";
import { postedAgo, type JobSource } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { stringsOf } from "./candidates";
import { AGENT_JOB_KEY } from "./jobs";
import { agentSetupProblem } from "./run";
import { AGENT_MAX_RUNS_PER_DAY, runsInPastDay } from "./runs";
import { nextAgentRun } from "./schedule";
import { runnableSearches, searchesOf } from "./searches";

// What the Agent screen shows (E16-6).

export type AgentCandidateView = {
  id: string;
  title: string;
  company: string;
  /** "Rotterdam · Remote · €70k", what's known of them. */
  facts: string;
  /** "Posted 2 days ago · via LinkedIn on JSearch". */
  origin: string;
  source: JobSource;
  url: string;
  score: number;
  reasons: string[];
  redFlags: string[];
  /** Why the last try at a draft failed. */
  error: string | null;
  /** The draft, once there is one. */
  applicationId: string | null;
  /** The job preparing its draft, while one is queued or running. */
  draftJobId: string | null;
  /** The saved search that found it: its current name, else the one stored with it; null for older postings. */
  search: { id: string; name: string } | null;
};

export type AgentView = {
  enabled: boolean;
  autoDraft: boolean;
  minScore: number;
  maxScores: number;
  maxDrafts: number;
  /** "3 saved searches on JSearch, Adzuna and FreeHire", or null without a runnable search. */
  searchSummary: string | null;
  /** One per search among the waiting postings, in saved-search order, removed ones last by name; empty with fewer than two. */
  filters: { id: string; name: string; count: number }[];
  /** Why it can't run: no saved search, provider or AI provider; null when it's set up. */
  setupProblem: string | null;
  /** Which settings section fixes it. */
  setupSection: "agent" | "ai" | "jobs" | null;
  /** The daily limit is used up. */
  limitReached: boolean;
  lastRun: { at: string; message: string | null } | null;
  /** In the user's zone; null while the agent is off. */
  nextRun: string | null;
  /** A run queued or running, to follow. */
  runJobId: string | null;
  drafts: AgentCandidateView[];
  /** At or above the minimum score, best first. */
  scored: AgentCandidateView[];
  /** Below it: kept so they don't come back, shown on request. */
  belowMinimum: AgentCandidateView[];
};

/** The Agent item's badge (E16-6): what's waiting for a look. */
export async function countAgentQueue(): Promise<number> {
  const { agentMinScore } = await loadSettings();
  return prisma.agentCandidate.count({
    where: {
      OR: [
        { status: AgentCandidateStatus.SCORED, score: { gte: agentMinScore } },
        { status: AgentCandidateStatus.DRAFTED, applicationId: { not: null } },
      ],
    },
  });
}

/** "Today" and "Yesterday" in a sentence; "2 days ago" or "15 Oct" as they are. */
const posted = (ago: string) => (ago === "Today" || ago === "Yesterday" ? ago.toLowerCase() : ago);

const sectionOf = (problem: string): AgentView["setupSection"] =>
  problem.includes("AI provider") ? "ai" : problem.includes("Job search") ? "jobs" : "agent";

/** The filter buttons: the searches the waiting postings came from, saved ones in order, removed ones after by name. */
function searchFilters(waiting: AgentCandidateView[], order: string[]): AgentView["filters"] {
  const found = new Map<string, { id: string; name: string; count: number }>();
  for (const { search } of waiting) {
    if (!search) continue;
    const entry = found.get(search.id) ?? { ...search, count: 0 };
    entry.count += 1;
    found.set(search.id, entry);
  }
  if (found.size < 2) return [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...found.values()].sort((a, b) => rank(a.id) - rank(b.id) || (rank(a.id) === order.length ? a.name.localeCompare(b.name) : 0));
}

export async function loadAgentView(now = new Date()): Promise<AgentView> {
  const [settings, config, timeZone, candidates, draftJobs, runJobs] = await Promise.all([
    loadSettings(),
    loadJobSearchConfig(),
    lastKnownTimeZone(),
    prisma.agentCandidate.findMany({
      where: { status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTING, AgentCandidateStatus.DRAFTED] } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    }),
    prisma.job.findMany({
      where: { type: "agent-draft", status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      select: { id: true, key: true },
    }),
    prisma.job.findMany({ where: { key: AGENT_JOB_KEY, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true }, take: 1 }),
  ]);
  const draftJob = new Map(draftJobs.map((job) => [job.key?.replace(/^agent-candidate:/, ""), job.id]));

  const searches = searchesOf(settings);
  const runnable = runnableSearches(searches);
  const names = agentSources(config).map((source) => SOURCE_INFO[source].name);
  const searchSummary =
    runnable.length > 0 && names.length > 0
      ? `${runnable.length} saved ${runnable.length === 1 ? "search" : "searches"} on ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}`
      : null;
  const setupProblem = await agentSetupProblem(settings, config);

  const view = (candidate: (typeof candidates)[number]): AgentCandidateView => ({
    id: candidate.id,
    title: candidate.title.trim() || "Untitled posting",
    company: candidate.company.trim(),
    facts: [candidate.place, candidate.remote ? "Remote" : "", candidate.salary].filter(Boolean).join(" · "),
    origin: [
      candidate.postedAt ? `Posted ${posted(postedAgo(candidate.postedAt.toISOString(), now))}` : "",
      [candidate.via ? `via ${candidate.via}` : "", `on ${SOURCE_INFO[candidate.source].name}`].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(" · "),
    source: candidate.source,
    url: candidate.url,
    score: candidate.score,
    reasons: stringsOf(candidate.reasons),
    redFlags: stringsOf(candidate.redFlags),
    error: candidate.error,
    applicationId: candidate.applicationId,
    draftJobId: draftJob.get(candidate.id) ?? null,
    search: candidate.searchId ? { id: candidate.searchId, name: searches.find((search) => search.id === candidate.searchId)?.name ?? candidate.searchName } : null,
  });
  const drafts = candidates.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId).map(view);
  const waiting = candidates.filter((candidate) => candidate.status !== AgentCandidateStatus.DRAFTED);
  const scored = waiting.filter((candidate) => candidate.score >= settings.agentMinScore).map(view);
  const belowMinimum = waiting.filter((candidate) => candidate.score < settings.agentMinScore).map(view);
  const last = settings.agentRuns[0];

  return {
    enabled: settings.agentEnabled,
    autoDraft: settings.agentAutoDraft,
    minScore: settings.agentMinScore,
    maxScores: settings.agentMaxScores,
    maxDrafts: settings.agentMaxDrafts,
    searchSummary,
    filters: searchFilters([...scored, ...belowMinimum], searches.map((search) => search.id)),
    setupProblem,
    setupSection: setupProblem ? sectionOf(setupProblem) : null,
    limitReached: runsInPastDay(settings.agentRuns, now).length >= AGENT_MAX_RUNS_PER_DAY,
    lastRun: last ? { at: formatDateTime(new Date(last.at), timeZone, now), message: last.message } : null,
    nextRun: settings.agentEnabled ? formatDateTime(nextAgentRun(now, settings.agentHour, timeZone, settings.agentRuns), timeZone, now) : null,
    runJobId: runJobs[0]?.id ?? null,
    drafts,
    scored,
    belowMinimum,
  };
}
