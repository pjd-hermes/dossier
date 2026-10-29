"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { planRequests } from "@/lib/agent/plan";
import { SOURCE_CAPS, type AgentSearch, type SourceCap, type SourceCaps as Caps } from "@/lib/agent/search-schema";
import { capOf, runnableSearches } from "@/lib/agent/searches";
import type { JobSource } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import type { AgentRun } from "@/lib/settings";

import { saveSourceCap } from "../agent/search-actions";

/** "A", "A and B", "A, B and C" */
export function joinWithAnd(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const capLabel = (cap: SourceCap) => (cap === 0 ? "Not used by the agent" : cap === "all" ? "Every search" : `${cap} a day`);

function capHint(source: JobSource, cap: SourceCap): string | undefined {
  if (cap === 0) return undefined;
  if (cap === "all") return source === "ADZUNA" ? "About 250 a day on a free key." : source === "FREEHIRE" ? "No quota." : "One for each search, every day.";
  return `About ${cap * 30} a month${source === "JSEARCH" ? " of your 200" : ""}`;
}

/** What the next run would do: which searches go to which providers, then the paused ones. */
function nextRun(searches: readonly AgentSearch[], sources: readonly JobSource[], caps: Caps, runs: readonly AgentRun[]): string {
  const runnable = runnableSearches(searches);
  const { requests } = planRequests({ searches: runnable, sources, caps, runs, now: new Date() });
  // Providers that get the same searches share a sentence.
  const groups: { names: string[]; sources: JobSource[] }[] = [];
  for (const source of sources) {
    const names = runnable.filter((search) => requests.some((request) => request.source === source && request.searchId === search.id)).map((search) => search.name);
    if (names.length === 0) continue;
    const same = groups.find((group) => group.names.join("\n") === names.join("\n"));
    if (same) same.sources.push(source);
    else groups.push({ names, sources: [source] });
  }
  // The providers that get the most come first.
  const parts = groups.sort((a, b) => b.sources.length - a.sources.length).map(({ names, sources: on }) => `${joinWithAnd(names)} on ${on.length === sources.length && on.length > 1 ? `all ${on.length}` : joinWithAnd(on.map((source) => SOURCE_INFO[source].name))}`);
  const paused = searches.filter((search) => !search.enabled).map((search) => ` ${search.name} is paused.`);
  return `Next run: ${parts.length > 0 ? parts.join(", and ") : "nothing to search"}.${paused.join("")}`;
}

/** How many searches a day the agent sends each provider, and what the next run will do. */
export function SourceCaps({
  initial,
  sources,
  searches,
  runs,
}: {
  initial: Caps;
  /** The providers the agent searches. */
  sources: readonly JobSource[];
  /** Live, so the preview follows edits to the searches. */
  searches: readonly AgentSearch[];
  runs: readonly AgentRun[];
}) {
  const track = useTrackSave();
  const [caps, setCaps] = useState(initial);

  const change = async (source: JobSource, cap: SourceCap) => {
    const previous = caps;
    setCaps({ ...caps, [source]: cap });
    if (source === "ARBEITSAGENTUR") return;
    const result = toastResult(await track(saveSourceCap({ source, cap })));
    if (!result.ok) setCaps(previous);
  };

  return (
    <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
      <div className="flex flex-col gap-1">
        <h3 className="text-field font-medium">Searches per provider, each day</h3>
        <p className="text-meta text-muted">Each provider has a quota, so choose how many of your searches it gets in a day.</p>
      </div>
      <div className="grid gap-x-[18px] gap-y-5 sm:grid-cols-2">
        {sources.map((source) => {
          const cap = capOf(caps, source);
          return (
            <div key={source} role="group" aria-label={SOURCE_INFO[source].name} className="flex flex-col gap-1.5">
              <span className="text-field font-medium">{SOURCE_INFO[source].name}</span>
              <Select
                label="At most"
                value={String(cap)}
                hint={capHint(source, cap)}
                onChange={(event) => void change(source, event.target.value === "all" ? "all" : (Number(event.target.value) as SourceCap))}
              >
                {SOURCE_CAPS.map((option) => (
                  <option key={option} value={String(option)}>
                    {capLabel(option)}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
      <p className="text-meta text-muted">{nextRun(searches, sources, caps, runs)}</p>
    </Card>
  );
}
