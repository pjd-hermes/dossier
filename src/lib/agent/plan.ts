import { dayOf } from "@/lib/calendar-view";
import type { JobSource } from "@/lib/job-search/search";
import { sourceCovers } from "@/lib/job-search/sources";
import type { AgentRun } from "@/lib/settings";

import { capOf } from "./searches";
import type { AgentSearch, SourceCaps } from "./search-schema";

// Pure, so the Job agent settings screen can preview a run in the browser.

export type PlannedRequest = { source: JobSource; searchId: string };
/** Searches a provider was not sent because its daily cap was used up. */
export type SkippedSource = { source: JobSource; reason: "cap"; cap: number; searchIds: string[] };

/**
 * Which searches go to which provider on this run: each provider gets at most
 * its cap per calendar day in the user's time zone, to the searches it has not
 * been asked about the longest.
 */
export function planRequests({ searches, sources, caps, runs, now, timeZone }: {
  /** Runnable, in list order. */
  searches: readonly AgentSearch[];
  /** With credentials, in `JOB_SOURCES` order. */
  sources: readonly JobSource[];
  caps: SourceCaps;
  /** Newest first, as stored. */
  runs: readonly AgentRun[];
  now: Date;
  /** The user's; a provider's cap resets at their midnight. */
  timeZone: string;
}): { requests: PlannedRequest[]; skipped: SkippedSource[] } {
  const today = dayOf(now, timeZone);
  const ranToday = runs.filter((run) => dayOf(new Date(run.at), timeZone) === today);
  const chosen = new Map<number, Set<JobSource>>();
  const skipped: SkippedSource[] = [];

  for (const source of sources) {
    const cap = capOf(caps, source);
    if (cap === 0) continue;
    const used = ranToday.reduce((sum, run) => sum + run.requests.filter((request) => request.source === source).length, 0);
    const remaining = cap === "all" ? searches.length : Math.max(0, cap - used);

    const candidates = searches
      .map((search, index) => ({ search, index, last: lastRan(runs, source, search.id) }))
      .filter(({ search }) => sourceCovers(source, search.country))
      // Never ran first, then the one that ran longest ago; ties keep list order.
      .sort((a, b) => a.last - b.last || a.index - b.index);

    for (const { index } of candidates.slice(0, remaining)) {
      chosen.set(index, (chosen.get(index) ?? new Set()).add(source));
    }
    const left = candidates.slice(remaining).sort((a, b) => a.index - b.index);
    if (left.length > 0 && cap !== "all") skipped.push({ source, reason: "cap", cap, searchIds: left.map(({ search }) => search.id) });
  }

  const requests = searches.flatMap((search, index) => sources.filter((source) => chosen.get(index)?.has(source)).map((source) => ({ source, searchId: search.id })));
  return { requests, skipped };
}

/** When a search last ran on a provider, as a timestamp; -Infinity when it never did. */
function lastRan(runs: readonly AgentRun[], source: JobSource, searchId: string): number {
  let last = -Infinity;
  for (const run of runs) {
    if (run.requests.some((request) => request.source === source && request.searchId === searchId)) last = Math.max(last, Date.parse(run.at));
  }
  return last;
}

/**
 * Chooses the postings to score, up to `max`, shared fairly: newest first within
 * each search, then one per search in `order`, round after round.
 */
export function pickToScore<T extends { postedAt: string | null }>(
  bySearch: ReadonlyMap<string, readonly T[]>,
  order: readonly string[],
  max: number,
): { searchId: string; posting: T }[] {
  const lists = order
    .map((searchId) => ({ searchId, postings: [...(bySearch.get(searchId) ?? [])].sort((a, b) => postedTime(b) - postedTime(a)) }))
    .filter(({ postings }) => postings.length > 0);
  const picked: { searchId: string; posting: T }[] = [];
  for (let round = 0; picked.length < max && lists.some(({ postings }) => round < postings.length); round++) {
    for (const { searchId, postings } of lists) {
      const posting = postings[round];
      if (posting && picked.length < max) picked.push({ searchId, posting });
    }
  }
  return picked;
}

/** Undated postings sort as oldest. */
const postedTime = ({ postedAt }: { postedAt: string | null }) => (postedAt ? Date.parse(postedAt) || 0 : -Infinity);
