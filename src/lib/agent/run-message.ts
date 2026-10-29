import type { JobSource } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";

import type { SkippedSource } from "./plan";

// What an agent run tells the user: what it searched where, what it couldn't,
// and what it found.

const nameOf = (source: JobSource) => SOURCE_INFO[source].name;

/** "JSearch, Adzuna and FreeHire". */
const listOf = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * "Searched 3 job types on Adzuna and FreeHire, and 2 on JSearch (its limit of
 * 2 a day)." `counts` is the searches each provider answered, `capped` the
 * providers held back by their daily limit; one with none left is named after.
 */
export function searchedSentence(counts: readonly [JobSource, number][], capped: readonly SkippedSource[]): string {
  const capOf = new Map(capped.map((skipped) => [skipped.source, skipped.cap]));
  const ran = counts.filter(([, count]) => count > 0);

  // Providers that ran as many searches as there were go together, the most first.
  const groups: { count: number; sources: JobSource[]; cap?: number }[] = [];
  for (const [source, count] of ran.filter(([source]) => !capOf.has(source))) {
    const group = groups.find((entry) => entry.count === count);
    if (group) group.sources.push(source);
    else groups.push({ count, sources: [source] });
  }
  groups.sort((a, b) => b.count - a.count);
  for (const [source, count] of ran.filter(([source]) => capOf.has(source))) groups.push({ count, sources: [source], cap: capOf.get(source) });

  const parts = groups.map(({ count, sources, cap }, index) => {
    const unit = index === 0 ? ` job ${count === 1 ? "type" : "types"}` : "";
    return `${count}${unit} on ${listOf(sources.map(nameOf))}${cap === undefined ? "" : ` (its limit of ${cap} a day)`}`;
  });
  const searched = parts.length === 0 ? "" : `Searched ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`}.`;

  const usedUp = capped
    .filter((skipped) => !ran.some(([source]) => source === skipped.source))
    .map((skipped) => `${nameOf(skipped.source)}'s limit of ${skipped.cap} a day is used up until later.`);
  return [searched, ...usedUp].filter(Boolean).join(" ");
}

/** A provider left out of the run because it can't be searched (no key, not accepted). */
export const skippedProblem = (source: JobSource, message: string) => `${nameOf(source)} was skipped: ${message}`;

/** A provider that failed during the run. */
export const failedProblem = (source: JobSource, message: string) => `${nameOf(source)} didn't answer: ${message}`;

/** The whole message: what was searched, what went wrong, then what came of it. */
export function runMessage({ searched, problems, tail }: { searched: string; problems: string[]; tail: string }): string {
  return [searched, ...problems, tail].filter(Boolean).join(" ");
}
