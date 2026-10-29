import "server-only";

import { credentialsFor, type JobSearchConfig } from "./config";
import { JobSearchError } from "./errors";
import type { JobSource } from "./search";

/** The providers the agent and saved searches may use: the Bundesagentur für Arbeit is only ever searched by hand. */
export function agentSources(config: JobSearchConfig): JobSource[] {
  return config.sourcesOn.filter((source) => source !== "ARBEITSAGENTUR");
}

/** What keeps a provider from being searched (no key, not accepted), as the message to show; null when nothing does. */
export function sourceProblem(config: JobSearchConfig, source: JobSource): string | null {
  try {
    credentialsFor(config, source);
    return null;
  } catch (error) {
    if (error instanceof JobSearchError) return error.message;
    throw error;
  }
}
