import { z } from "zod";

import { JOB_SOURCES, searchQuerySchema } from "@/lib/job-search/search";

/** The most saved searches the agent runs each day. */
export const MAX_AGENT_SEARCHES = 5;

/** One saved search: a query with a name, which can be paused. */
export const agentSearchSchema = searchQuerySchema.extend({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
});
export type AgentSearch = z.output<typeof agentSearchSchema>;

/** How many searches a day each provider may be sent. */
export const SOURCE_CAPS = [0, 1, 2, 3, 4, 5, "all"] as const;
export type SourceCap = (typeof SOURCE_CAPS)[number];

/** A provider that isn't listed has no cap ("all"). */
export const sourceCapsSchema = z.partialRecord(z.enum(JOB_SOURCES), z.union([z.literal([0, 1, 2, 3, 4, 5]), z.literal("all")]));
export type SourceCaps = z.output<typeof sourceCapsSchema>;

export const DEFAULT_SOURCE_CAPS: SourceCaps = { JSEARCH: 2 };
