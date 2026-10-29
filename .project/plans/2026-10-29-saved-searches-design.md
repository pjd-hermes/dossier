# Design: several job providers and saved searches by job type (roadmap step 2)

Agreed with PJ on 2026-10-29. Mockups: [Saved searches mockups](https://claude.ai/artifact/E8uhVJUJiWec5gxv1cx838).
Base: Dossier 1.10.0 (merged into the fork on this branch), which added FreeHire as a fourth job source.

## Goal

PJ searches by job type (Software Engineer, IT Specialist, Database Admin), not by employer. Today Dossier
searches **one** provider and the job agent runs **one** search. After this step:

1. Settings → Job search turns any number of providers on at once, each with its own key and test.
2. Settings → Job agent holds up to 5 named saved searches, and every run sends each one to every
   provider that's on, within a per-provider daily cap.
3. The Agent screen tags each posting with the search that found it, and filters by search.
4. Find jobs gets a picker for which of the providers that are on to search.

### Success criteria

- With JSearch, Adzuna and FreeHire on and three searches saved, one scheduled run searches all three on
  Adzuna and FreeHire, and two on JSearch (default cap); the third gets JSearch first on the next run.
- JSearch requests made by the agent never exceed its cap in any 24 hours, whether runs are scheduled or
  Run now.
- An existing install upgrades with no action: its one provider stays on, and its one agent search becomes
  the first saved search.
- Coverage gates (86 % overall, 94 % `src/lib`) and `session-audit.test.ts` still pass.

### Decided with PJ

| Question | Decision |
|---|---|
| Fork-only or upstream? | Fork-only. We may go past the maintainer-approved scope of upstream issue #11. |
| Find jobs with several providers on | A provider picker (one provider per search), not a fan-out. |
| How the agent spends requests | Every search on every provider, every run, with a per-provider daily cap; searches take turns where the cap is smaller. |
| Tag postings with their search | Yes, with a filter on the Agent screen. Needs a migration. |
| Extras shown in the mockups | Keep all three: a pause switch per search, a request counter per provider, one tag per posting (the first search that found it). |

## Design rules for the fork

So that upstream releases keep merging cleanly (see `FORK.md`, added by this step):

1. New logic goes in new files. Upstream files get thin calls into them; no renames, no reformatting.
2. Settings JSON before new tables. Only the one change PJ chose (the search tag) touches Prisma.
3. Every upstream file changed is listed in `FORK.md` with one line on why.
4. Merge upstream release tags, never rebase; `git config rerere.enabled true`.

## Data

### Settings (no migration)

All in `src/lib/settings.ts` (`settingsSchema`), next to the keys they replace or extend.

| Key | Shape | Default | Notes |
|---|---|---|---|
| `jobSourcesOn` | `JobSource[]`, JSON | `null` | `null` means "not chosen yet": derived from `jobSource` (or `DOSSIER_JOBS_SOURCE`) as a one-item list. Saving any switch writes the full list. |
| `jobSource` | existing | existing | Kept. Now means **Find jobs' provider**: the last one picked there, used as the picker's default. Must be one of `jobSourcesOn`, else the first of them. |
| `agentSearches` | `AgentSearch[]`, JSON, at most 5 | `null` | `null` means "not set yet": derived from `agentQuery` (one search, named after its keywords) when that has keywords, else `[]`. |
| `agentQuery` | existing | existing | Read only for that one-time derivation; never written again. Left in place so an older Dossier reading the same database still works. |
| `agentSourceCaps` | `Partial<Record<JobSource, 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| "all">>`, JSON | `{ JSEARCH: 2 }` | A provider not listed means "all". 0 = "Not used by the agent". The dropdown offers 0, 1–5, "all". The Bundesagentur is never searched by the agent, whatever is stored. |
| `jobSourceUsage` | `Record<JobSource, Record<"YYYY-MM-DD", number>>`, JSON | `{}` | Requests that reached a provider (not cache hits), by UTC day, trimmed to the last 31 days on every write. A lost increment from two requests at the same moment is acceptable: it is a guide, not a limit. |

```ts
// src/lib/agent/searches.ts
export const agentSearchSchema = searchQuerySchema.extend({
  id: z.string().min(1).max(40),        // cuid-like, made on the server when a search is added
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),                 // the pause switch
});
```

`agentRunSchema` gains `requests: { source, searchId }[]` (default `[]`). It is what the cap and the
turn-taking read, so they hold whatever the task-data sweep deletes, as the run limit already does.
`AGENT_RUNS_KEPT` goes from 10 to 30 (10 days at 3 runs a day) so turn-taking sees far enough back.

### Prisma (one migration)

`AgentCandidate` gains:

```prisma
/// The saved search that found it first (step 2); null for candidates from before saved searches.
searchId   String?
/// That search's name when it was found, shown if the search is later removed.
searchName String  @default("")
@@index([searchId])
```

Merge tax for this change: `data-export.ts` (`agentCandidate` schema gains both fields with defaults, so
older files still import), `data-import.ts` (writes them), delete-everything (already deletes all
candidates; its test asserts it), backups (they write the export, so they're covered by the export test).

## Components

Each new unit has one job and can be tested without the screen.

| Unit | File | What it does |
|---|---|---|
| Providers on | `src/lib/job-search/providers-on.ts` (new) | `sourcesOn(config)`; `agentSources(config)` (on, has credentials, not Bundesagentur); `findJobsSource(config)`. |
| Config | `src/lib/job-search/config.ts` (upstream, small) | `JobSearchConfig` gains `sourcesOn: JobSource[]`; `source` stays as Find jobs' provider. `jobSearchView` adds `sourcesOn`. |
| Usage counter | `src/lib/job-search/usage.ts` (new) | `countRequest(source, now)` and `usageSince(source, days, now)`. Called from `searchPostings`, `postingDetails` and `testSource` in `index.ts` only when the request isn't a cache hit (one line each). |
| Saved searches | `src/lib/agent/searches.ts` (new) | Schema, `loadAgentSearches()` (with the `agentQuery` derivation), add, update, remove, at most 5. |
| Request planner | `src/lib/agent/plan.ts` (new, pure) | `planRequests(searches, sources, caps, runs, now)` → ordered `{ source, searchId }[]`, plus `skipped` per source with the reason. |
| Fair scoring pick | `src/lib/agent/plan.ts` | `pickToScore(freshBySearch, max)`: newest first within each search, then one from each search in turn until `max`. |
| Agent run | `src/lib/agent/run.ts` (upstream, moderate) | Runs the plan instead of one search; see Data flow. |
| Settings actions | `src/app/(app)/settings/actions.ts` (upstream, small) + `src/app/(app)/settings/provider-actions.ts` (new) | Provider on/off, per-provider test, saved-search CRUD, caps. Every action through `action()`. |
| Job search section | `src/app/(app)/settings/job-search-section.tsx` (upstream, rewritten in place) | Provider cards with switch, keys, Test connection, usage line. Key fields reuse `KeyField`. |
| Job agent section | `src/app/(app)/settings/agent-section.tsx` (upstream) + `saved-searches.tsx` and `source-caps.tsx` (new) | The saved-searches card and the per-provider caps card with the next-run preview. |
| Agent screen | `src/lib/agent/view.ts`, `src/app/(app)/agent/agent-screen.tsx` (upstream, small) | Tag on each card; filter buttons with counts; summary line names searches and providers. |
| Find jobs | `src/app/(app)/jobs/search-fields.tsx`, `src/lib/posting-searches.ts`, `src/lib/job-search/find.ts` (upstream, small) | Picker of providers that are on; the pick is sent with the search and saved as `jobSource`. |
| Claude connector | `src/lib/connector/tools.ts` (upstream, small) | `find_jobs` takes an optional `source`; without it, Find jobs' provider. |
| Fork notes | `FORK.md` (new) | Files changed and why; how to sync upstream. |

## Data flow: one agent run

1. `runAgentScan` loads settings, `agentSources(config)` and the enabled searches. Setup problems that
   stop the run: no enabled search, no agent-capable provider on, AI not configured. A provider whose key
   is missing is **skipped with a note**, not a stop.
2. The 3-runs-a-day limit and the Run now hour are unchanged.
3. `planRequests`:
   - For each provider, `remaining = cap − requests to it in agent runs of the past 24 h` (`"all"` means
     the number of enabled searches; 0 skips it).
   - Order the enabled searches by when they last ran **on that provider** (never first, then oldest),
     ties by their order in the list. Take the first `remaining`.
   - Interleave the result by search, so a failing provider late in the list doesn't starve a search.
4. The run is recorded with its planned requests **before** any is sent (as today), so a crash can't
   spend a provider's cap twice.
5. Each request asks for the first page only. A `JobSearchError` from one provider is noted and the run
   goes on with the others.
6. Results are de-duplicated with `newPostings` across everything this run found; a posting found by two
   searches keeps the **first in list order**.
7. `pickToScore` chooses up to `agentMaxScores`, shared fairly. Each candidate is created with `searchId`
   and `searchName`.
8. Auto-draft is unchanged. The message names what ran and what was skipped, e.g. "Searched 3 job types
   on Adzuna and FreeHire, and 2 on JSearch (its limit of 2 a day). 6 new postings are waiting for a look."

## Screens

As in the mockups. Notes the mockups don't show:

- **Job search:** a provider switched off keeps its key. The Bundesagentur card keeps its "I understand"
  note and switch rules (#223), and says the agent never searches it. With every provider off, Find jobs
  and the agent say so, as today's "Off" does.
- **Job agent:** a search needs a name, keywords and a country to be saved enabled (as today's turn-on
  check). Editing autosaves like today's search. "Add a search" is disabled at 5. Removing a search keeps
  its candidates and their tag (shown from `searchName`).
- **Usage line:** "Used in the past 30 days: 41 of 200 (counted by Dossier)" (the mockup says "this month"; this wording wins, since JSearch's month follows its billing date) for providers with a quota; the
  provider's own count may differ (other apps, other servers, its billing date). Find jobs shows it next
  to JSearch.
- **Agent screen:** filter buttons appear only with two or more searches that have candidates.
  "All searches" is the default and isn't remembered.

## Errors

- A provider failing (bad key, quota used up, unavailable): the run continues, the message names it, and
  the request still counts against the cap (it was spent or refused by the provider).
- Every provider failing: the run ends with the first error's message, as today.
- A saved search whose country a provider doesn't cover (`sourceCovers`): that pair is left out of the
  plan and doesn't count against the cap.
- Corrupt JSON in any new setting falls back to its default through the schema's `.catch`, as the
  existing settings do.

## Testing

- Pure unit tests: `planRequests` (caps, "all", 0, turn-taking across runs, the 24 h window, ties,
  unsupported countries), `pickToScore`, `sourcesOn` and the legacy derivations, usage trimming.
- DB tests: `run.db.test.ts` for a three-search, three-provider run with a fake adapter per provider,
  one provider failing, Run now after a capped run; settings actions; export/import round trip with the
  new candidate fields, and an old export without them; delete-everything.
- UI tests: Job search section (switches, per-provider test, keys), Job agent section (add, edit,
  pause, remove, the 5 limit, caps dropdown), Agent screen (tags, filters), Find jobs picker.
- `session-audit.test.ts` covers the new actions file automatically.
- Manual (PJ, local Docker): the whole flow against real JSearch, Adzuna and FreeHire keys.

## Out of scope

- Searching every provider at once from Find jobs (decided: picker).
- Per-search minimum score or per-search scoring limits.
- Running the agent more than once a day on a schedule.
- Upstreaming any of this.
