"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { agentSearchSchema, MAX_AGENT_SEARCHES, type AgentSearch } from "@/lib/agent/search-schema";
import { newSearchId, searchesOf, searchReady } from "@/lib/agent/searches";
import { EMPTY_QUERY } from "@/lib/job-search/search";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The saved searches and provider caps of Settings → Job agent. Every write
// saves the list as it stands first, so a search that was only the old
// `agentQuery` keeps its id ("legacy") from then on.

const searchId = z.string().min(1).max(40);

export const addAgentSearch = action(z.object({}), async () => {
  const searches = searchesOf(await loadSettings());
  if (searches.length >= MAX_AGENT_SEARCHES) throw new ActionError(`You can keep up to ${MAX_AGENT_SEARCHES} saved searches. Remove one first.`);
  const added: AgentSearch = { ...EMPTY_QUERY, id: newSearchId(), name: "New search", enabled: false };
  await saveSettings({ agentSearches: [...searches, added] });
  revalidatePath("/agent");
  return added;
});

export const updateAgentSearch = action(
  z.object({ id: searchId, changes: agentSearchSchema.omit({ id: true }).partial() }),
  async ({ id, changes }) => {
    const searches = searchesOf(await loadSettings());
    const current = searches.find((search) => search.id === id);
    if (!current) throw new ActionError("That search was removed.");
    const updated = { ...current, ...changes };
    if (changes.enabled && !searchReady(updated)) throw new ActionError("Add what to look for and a country before turning this search on.");
    await saveSettings({ agentSearches: searches.map((search) => (search.id === id ? updated : search)) });
    revalidatePath("/agent");
    return updated;
  },
);

export const removeAgentSearch = action(z.object({ id: searchId }), async ({ id }, { toast }) => {
  await saveSettings({ agentSearches: searchesOf(await loadSettings()).filter((search) => search.id !== id) });
  revalidatePath("/agent");
  toast("Search removed. Postings it found stay on the Agent screen.");
  return null;
});

/** How many searches a day the agent sends a provider. */
export const saveSourceCap = action(
  z.object({
    source: z.enum(["JSEARCH", "ADZUNA", "FREEHIRE"]),
    cap: z.union([z.literal([0, 1, 2, 3, 4, 5]), z.literal("all")]),
  }),
  async ({ source, cap }) => {
    const { agentSourceCaps } = await loadSettings();
    await saveSettings({ agentSourceCaps: { ...agentSourceCaps, [source]: cap } });
    revalidatePath("/agent");
    return null;
  },
);
