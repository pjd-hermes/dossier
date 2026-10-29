import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import { searchPostings } from "@/lib/job-search";
import { credentialsFor, loadJobSearchConfig, requestContext, type JobSearchConfig } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { agentSources, sourceProblem } from "@/lib/job-search/providers-on";
import { postingKey, postingText, type FoundPosting, type JobSource } from "@/lib/job-search/search";
import { startJob, type JobContext } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { saveScore } from "@/lib/posting-scores";
import { postingStates } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { agentDedupeKey, candidateData } from "./candidates";
import { agentDraftJob, draftJobKey } from "./draft";
import { pickToScore, planRequests } from "./plan";
import { failedProblem, runMessage, searchedSentence, skippedProblem } from "./run-message";
import { recordRunEnd, recordRunStart, runLimitProblem } from "./runs";
import { runnableSearches, searchesOf } from "./searches";

// One run of the job agent (E16-3): each saved search on each provider that's
// on, within their daily caps, the postings seen before dropped, and a score
// for the newest of the rest. It never sends anything.
// Adapted from avinashbatchala's fork of Dossier.

export const agentScanResultSchema = z.object({
  /** Postings the source returned. */
  found: z.number().int().min(0),
  /** Of those, the ones not seen before. */
  fresh: z.number().int().min(0),
  scored: z.number().int().min(0),
  drafted: z.number().int().min(0),
  /** Found but seen before: saved, dismissed or applied for in Find jobs, or a candidate already. */
  skipped: z.number().int().min(0),
  /** What to tell the user. */
  message: z.string(),
});
export type AgentScanResult = z.infer<typeof agentScanResultSchema>;

const stopped = (message: string): AgentScanResult => ({ found: 0, fresh: 0, scored: 0, drafted: 0, skipped: 0, message });

/** Why the agent can't run at all, in words, or null when it's set up. A provider without its key is skipped, not a problem. */
export async function agentSetupProblem(settings: SettingsData, config: JobSearchConfig): Promise<string | null> {
  if (runnableSearches(searchesOf(settings)).length === 0) return "Add a saved search in Settings → Job agent first.";
  // It never searches the Bundesagentur für Arbeit on its own, which the BA's terms forbid most clearly (#223).
  if (agentSources(config).length === 0) return "Turn on JSearch, Adzuna or FreeHire in Settings → Job search first.";
  if (!(await isAiConfigured())) return "Choose an AI provider in Settings → AI provider first.";
  return null;
}

/** The postings from a page that are new to the agent: not saved, dismissed or applied for, and not a candidate already. */
export async function newPostings(postings: readonly FoundPosting[]): Promise<FoundPosting[]> {
  const states = await postingStates(postings);
  const unseen = postings.filter((posting) => {
    const state = states.get(postingKey(posting));
    return !state?.saved && !state?.dismissed && !state?.applicationId;
  });
  const keys = unseen.map(agentDedupeKey);
  const known = await prisma.agentCandidate.findMany({
    where: { OR: [...unseen.map(({ source, externalId }) => ({ source, externalId })), { dedupeKey: { in: keys } }] },
    select: { source: true, externalId: true, dedupeKey: true },
  });
  const seen = new Set(known.flatMap((candidate) => [postingKey(candidate), candidate.dedupeKey]));
  // The same job twice in one page counts once too.
  return unseen.filter((posting, index) => {
    const fresh = !seen.has(postingKey(posting)) && !seen.has(keys[index]);
    seen.add(keys[index]);
    return fresh;
  });
}

/**
 * One run: the first page of results only for each planned (search,
 * provider) request, then a score for the newest new postings, up to
 * agentMaxScores shared across the searches. Each is kept as a candidate,
 * tagged with the search that found it first, so it doesn't come back; one
 * below agentMinScore stays out of the queue. With auto-draft on, the best of
 * them get a draft each, up to agentMaxDrafts, each its own job. A scheduled
 * run does nothing while the agent is off.
 */
export async function runAgentScan({ manual }: { manual: boolean }, context: JobContext, now = new Date()): Promise<AgentScanResult> {
  const settings = await loadSettings();
  if (!settings.agentEnabled && !manual) return stopped("The job agent is off.");
  const config = await loadJobSearchConfig();
  const setup = await agentSetupProblem(settings, config);
  if (setup) return stopped(setup);
  const limit = runLimitProblem(settings.agentRuns, now, { manual: false });
  if (limit) return stopped(limit);

  const searches = runnableSearches(searchesOf(settings));
  const searchById = new Map(searches.map((search) => [search.id, search]));
  const problems: string[] = [];
  const sources = agentSources(config).filter((source) => {
    const problem = sourceProblem(config, source);
    if (problem) problems.push(skippedProblem(source, problem));
    return !problem;
  });
  const plan = planRequests({ searches, sources, caps: settings.agentSourceCaps, runs: settings.agentRuns, now });

  const run = await recordRunStart(now, manual, plan.requests);
  const finish = async (result: AgentScanResult) => {
    await recordRunEnd(run, result.message);
    return result;
  };
  if (sources.length === 0) return finish(stopped(problems.join(" ")));
  if (plan.requests.length === 0) {
    const tail = plan.skipped.length > 0 ? "Nothing to search until then." : "None of the providers that are on can run your saved searches.";
    return finish(stopped(runMessage({ searched: searchedSentence([], plan.skipped), problems, tail })));
  }

  await context.step("Searching for new postings");
  const found: { searchId: string; posting: FoundPosting }[] = [];
  const answered = new Map<JobSource, number>();
  const failed = new Map<JobSource, JobSearchError>();
  for (const { source, searchId } of plan.requests) {
    // A provider that failed isn't asked again this run: its key, quota or service is the trouble.
    if (failed.has(source)) continue;
    try {
      // The first page only: the agent never asks for a second.
      const { postings } = await searchPostings(source, credentialsFor(config, source), searchById.get(searchId)!, null, requestContext(source));
      answered.set(source, (answered.get(source) ?? 0) + 1);
      found.push(...postings.map((posting) => ({ searchId, posting })));
    } catch (error) {
      if (!(error instanceof JobSearchError)) throw error;
      failed.set(source, error);
    }
  }
  // Every provider failed: the first one's error says why.
  if (answered.size === 0) return finish(stopped([...failed.values()][0].message));

  for (const [source, error] of failed) problems.push(failedProblem(source, error.message));
  const searched = searchedSentence(
    sources.map((source): [JobSource, number] => [source, answered.get(source) ?? 0]),
    plan.skipped.filter((skipped) => !failed.has(skipped.source)),
  );
  const say = (tail: string) => runMessage({ searched, problems, tail });

  // Found by several searches, a posting goes with the first in list order.
  const fresh = await newPostings(found.map(({ posting }) => posting));
  const searchOf = new Map<FoundPosting, string>();
  for (const { searchId, posting } of found) if (!searchOf.has(posting)) searchOf.set(posting, searchId);
  const counts = { found: found.length, fresh: fresh.length, skipped: found.length - fresh.length, drafted: 0 };
  if (fresh.length === 0) return finish({ ...counts, scored: 0, message: say(found.length === 0 ? "The search found no postings this time." : "No new postings this time.") });

  const bySearch = new Map<string, FoundPosting[]>();
  for (const posting of fresh) {
    const searchId = searchOf.get(posting)!;
    bySearch.set(searchId, [...(bySearch.get(searchId) ?? []), posting]);
  }
  const toScore = pickToScore(bySearch, searches.map((search) => search.id), settings.agentMaxScores);
  await context.step(`Scoring ${toScore.length} ${toScore.length === 1 ? "posting" : "postings"}`);
  const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
  let scored = 0;
  let queued = 0;
  const kept: string[] = [];
  let problem: string | null = null;
  for (const { searchId, posting } of toScore) {
    if (context.signal.aborted) break;
    try {
      const { data, promptVersion } = await scorePosting(
        provider,
        { posting: postingText(posting), title: posting.title, company: posting.company, place: posting.place, remote: posting.remote, salary: posting.salary, profile },
        { ...options, signal: context.signal },
      );
      const candidate = await prisma.agentCandidate.create({ data: candidateData(posting, data, { id: searchId, name: searchById.get(searchId)!.name }), select: { id: true } });
      // Find jobs shows it too (#208).
      await saveScore(posting, data, promptVersion);
      kept.push(candidate.id);
      scored += 1;
      if (data.score >= settings.agentMinScore) queued += 1;
    } catch (error) {
      // Another run kept it first: it's seen either way.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      // One posting that fails doesn't stop the rest.
      if (error instanceof AiError) problem = error.message;
      else if (!context.signal.aborted) logServerError("job agent scoring", error);
    }
  }

  // Auto-draft (#197, off by default): the best of this run's, one job each.
  let drafted = 0;
  if (settings.agentAutoDraft && settings.agentMaxDrafts > 0 && !context.signal.aborted) {
    const best = await prisma.agentCandidate.findMany({
      where: { id: { in: kept }, status: AgentCandidateStatus.SCORED, score: { gte: settings.agentMinScore } },
      orderBy: { score: "desc" },
      take: settings.agentMaxDrafts,
      select: { id: true },
    });
    for (const { id } of best) await startJob(agentDraftJob, { candidateId: id }, { key: draftJobKey(id) });
    drafted = best.length;
  }

  const waiting = `${queued} new ${queued === 1 ? "posting is" : "postings are"} waiting for a look.`;
  const tail =
    scored === 0
      ? (problem ?? "No postings could be scored this time.")
      : queued === 0
        ? `Scored ${scored} new ${scored === 1 ? "posting" : "postings"}; none reached your minimum score of ${settings.agentMinScore}.`
        : drafted > 0
          ? `${waiting} Preparing ${drafted === 1 ? "a draft for the best one" : `drafts for the best ${drafted}`}.`
          : waiting;
  return finish({ ...counts, scored, drafted, message: say(tail) });
}
