import type { JobSource, SearchQuery } from "@/lib/job-search/search";
import type { SettingsData } from "@/lib/settings";

import type { AgentSearch, SourceCap, SourceCaps } from "./search-schema";

/**
 * The saved searches. Before there were several, the agent had one search,
 * `agentQuery`: while no list is saved, that one stands in for it.
 */
export function searchesOf(settings: Pick<SettingsData, "agentSearches" | "agentQuery" | "agentEnabled">): AgentSearch[] {
  if (settings.agentSearches !== null) return settings.agentSearches;
  const { agentQuery } = settings;
  if (!agentQuery.keywords) return [];
  return [{ ...agentQuery, id: "legacy", name: agentQuery.keywords.slice(0, 80), enabled: true }];
}

/** A search needs keywords and a country to run. */
export const searchReady = (search: SearchQuery) => Boolean(search.keywords.trim() && search.country);

/** The searches a run makes, in list order: not paused, and ready. */
export const runnableSearches = (searches: readonly AgentSearch[]): AgentSearch[] =>
  searches.filter((search) => search.enabled && searchReady(search));

/** The most searches a day a provider is sent. The Bundesagentur für Arbeit is never searched by the agent. */
export const capOf = (caps: SourceCaps, source: JobSource): SourceCap => (source === "ARBEITSAGENTUR" ? 0 : (caps[source] ?? "all"));

export const newSearchId = () => crypto.randomUUID().slice(0, 12);
