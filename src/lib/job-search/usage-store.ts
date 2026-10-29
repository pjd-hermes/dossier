import "server-only";

import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import type { JobSource } from "./search";
import { dayKey, trimUsage } from "./usage";

/**
 * Counts one request sent to `source`, today. A search must not fail or wait
 * on this, so a failure is logged and goes no further. Two requests at once
 * may lose one count; that is fine for a figure the provider keeps itself.
 */
export async function countRequest(source: JobSource, now = new Date()): Promise<void> {
  try {
    const { jobSourceUsage } = await loadSettings();
    const today = dayKey(now);
    const days = jobSourceUsage[source] ?? {};
    const counted = { ...jobSourceUsage, [source]: { ...days, [today]: (days[today] ?? 0) + 1 } };
    await saveSettings({ jobSourceUsage: trimUsage(counted, now) });
  } catch (error) {
    logServerError("job search usage", error);
  }
}
