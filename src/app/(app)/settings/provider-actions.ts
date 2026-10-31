"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { JobSearchError, testSource } from "@/lib/job-search";
import { credentialsFor, jobSearchView, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JOB_SOURCES } from "@/lib/job-search/search";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Settings → Job search, a card per provider: each has its own switch and its
// own test. They return what the section shows, never a key.

const loadView = async () => jobSearchView(await loadJobSearchConfig(), (await loadSettings()).jobSourceUsage);

/**
 * Turns a provider on or off: writes the whole list of providers that are on.
 * The Bundesagentur für Arbeit only with its note accepted, now (`accepted`)
 * or before, and only while the server offers it (#223). Keys stay as they are.
 */
export const setJobSourceOn = action(
  z.object({ source: z.enum(JOB_SOURCES), on: z.boolean(), accepted: z.literal(true).optional() }),
  async ({ source, on, accepted }) => {
    const config = await loadJobSearchConfig();
    const accepting = on && source === "ARBEITSAGENTUR" && accepted === true;
    if (on && source === "ARBEITSAGENTUR") {
      if (!config.arbeitsagentur.offered) throw new ActionError("The Bundesagentur für Arbeit isn't offered on this server.");
      if (!accepting && !config.arbeitsagentur.acceptedAt) throw new ActionError("Tick “I understand” under the note about the Bundesagentur für Arbeit first.");
    }
    const jobSourcesOn = JOB_SOURCES.filter((name) => (name === source ? on : config.sourcesOn.includes(name)));
    await saveSettings({ jobSourcesOn, ...(accepting ? { arbeitsagenturAcceptedAt: new Date().toISOString() } : {}) });
    return loadView();
  },
);

/** "Test connection" on a provider's card: the smallest request it takes, timed. */
export const testJobSourceOf = action(z.object({ source: z.enum(JOB_SOURCES) }), async ({ source }) => {
  const config = await loadJobSearchConfig();
  const started = performance.now();
  try {
    await testSource(source, credentialsFor(config, source), requestContext(source));
    return { connected: true as const, seconds: Math.round((performance.now() - started) / 100) / 10 };
  } catch (error) {
    if (error instanceof JobSearchError) return { connected: false as const, message: error.message };
    throw error;
  }
});
