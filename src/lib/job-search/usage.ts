import { SOURCE_INFO } from "./sources";
import type { JobSource } from "./search";

// What Dossier has sent to each job provider, counted per day (UTC) so
// Settings and Find jobs can show how much of a quota is used. Pure, so
// client code can import it; usage-store.ts does the counting.

/** Requests per provider per day, by "YYYY-MM-DD". */
export type JobSourceUsage = Partial<Record<JobSource, Record<string, number>>>;

/** Days of usage kept, and days shown. */
const KEPT_DAYS = 31;
export const SHOWN_DAYS = 30;

/** Requests a provider allows per month, where that is known. */
export const MONTHLY_QUOTA: Partial<Record<JobSource, number>> = { JSEARCH: 200 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day as "YYYY-MM-DD" in UTC. */
export const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** The earliest day that is inside the last `days` days, today being the first. */
const since = (days: number, now: Date) => dayKey(new Date(now.getTime() - (days - 1) * DAY_MS));

/** The usage without the days older than the 31 kept. */
export function trimUsage(usage: JobSourceUsage, now: Date): JobSourceUsage {
  const first = since(KEPT_DAYS, now);
  return Object.fromEntries(
    Object.entries(usage).map(([source, days]) => [source, Object.fromEntries(Object.entries(days).filter(([day]) => day >= first))]),
  );
}

/** How many requests were sent to `source` in the last `days` days, today included. */
export function requestsInPastDays(usage: JobSourceUsage, source: JobSource, days: number, now: Date): number {
  const first = since(days, now);
  return Object.entries(usage[source] ?? {}).reduce((sum, [day, count]) => (day >= first ? sum + count : sum), 0);
}

/** The line under a provider that counts what was used; null for one without a quota. */
export function usageLine(source: JobSource, used: number): string | null {
  if (SOURCE_INFO[source].quotaPeriod === null) return null;
  const quota = MONTHLY_QUOTA[source];
  return `Used in the past ${SHOWN_DAYS} days: ${quota === undefined ? used : `${used} of ${quota}`} (counted by Dossier)`;
}
