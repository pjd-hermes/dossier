# This fork

## What this fork is

PJ's own copy of [AienTech/dossier](https://github.com/AienTech/dossier), used for PJ's job search. It carries
changes that are not meant for upstream and are not offered back.

## Syncing upstream

1. `git fetch upstream --tags`
2. Once per clone: `git config rerere.enabled true`, so a conflict resolved once stays resolved.
3. Merge the release tag into a branch: `git switch -c sync/<tag>` then `git merge <tag>`.
4. Test with `docker/bin/yarn test` (and `typecheck`, `lint`), fix what the merge broke, then merge the branch.

Never rebase: the fork's history stays as it is, and each upstream release arrives as one merge.

## Rules

1. New logic goes in new files. Upstream files get thin calls into them; no renames, no reformatting.
2. Settings JSON before new tables. Only the search tag touches Prisma.
3. Every upstream file changed is listed below with one line on why.
4. Merge upstream release tags, never rebase.

## Upstream files we change

| File | Why | Since |
|---|---|---|
| `src/lib/env.ts` | The OpenCode Go AI provider in `AI_PROVIDERS` | 1.10.0 merge (70b25f1) |
| `src/lib/ai/providers.live.test.ts` | A live check for OpenCode Go beside upstream's Anthropic one | 1.10.0 merge (70b25f1) |
| `DEVELOPMENT.md` | The OpenCode Go live check, beside the Anthropic one | 1.10.0 merge (70b25f1) |
| `package.json`, `yarn.lock` | The step 1 dependency patch; upstream's versions taken in the merge | 1.10.0 merge (70b25f1) |
| `src/lib/settings.ts` | The `jobSourcesOn` setting (several job providers on at once) and `jobSourceUsage` (requests counted per provider) | Saved searches, task 1 |
| `src/lib/settings.test.ts` | Tests for `jobSourcesOn`; `jobSourceUsage` in the defaults | Saved searches, task 1 |
| `src/lib/job-search/config.ts` | `sourcesOn` in the job search config and its view; `source` now means Find jobs' provider | Saved searches, task 1 |
| `src/lib/job-search/config.test.ts` | Tests for `sourcesOn` | Saved searches, task 1 |
| `src/lib/job-search/sources.ts` | `sourcesOn` in `JobSearchSettingsView` | Saved searches, task 1 |
| `src/app/(app)/settings/job-search-section.test.tsx` | The view fixture gains `sourcesOn` | Saved searches, task 1 |
| `src/app/(app)/settings/actions.db.test.ts` | The view it expects after saving a source gains `sourcesOn` | Saved searches, task 1 |
| `src/lib/data-export.ts` | `jobSourceUsage` joins `INSTALL_SETTINGS`: request counts stay out of exports | Saved searches, task 2 |
| `src/lib/data-export.db.test.ts` | The install-settings case covers `jobSourceUsage` | Saved searches, task 2 |
| `src/lib/job-search/index.ts` | A `countRequest` call before each request sent to a provider | Saved searches, task 2 |
| `src/lib/job-search/index.test.ts` | Tests for the request counting | Saved searches, task 2 |
| `src/lib/job-search/config.ts` | `jobSearchView(config, usage, now)` adds the past 30 days of requests | Saved searches, task 3 |
| `src/lib/job-search/config.test.ts` | Tests for a saved list beating a saved Off, and for `usage` | Saved searches, task 3 |
| `src/lib/job-search/sources.ts` | `usage` in `JobSearchSettingsView` | Saved searches, task 3 |
| `src/app/(app)/settings/actions.ts` | `loadView` passes the saved usage | Saved searches, task 3 |
| `src/app/(app)/settings/actions.db.test.ts` | The view it expects gains `usage` | Saved searches, task 3 |
| `src/app/(app)/settings/page.tsx` | The initial job search view gets the saved usage | Saved searches, task 3 |
| `src/app/(app)/settings/job-search-section.tsx` | A card per provider, each with a switch, its keys and its own test, replacing the radio choice | Saved searches, task 3 |
| `src/app/(app)/settings/job-search-section.test.tsx` | Tests for the cards | Saved searches, task 3 |
| `e2e/find-jobs.spec.ts` | The Settings tests use the providers' switches and cards | Saved searches, task 3 |
| `src/lib/posting-searches.ts` | `runSearch(query, source?)` searches a provider that is on and remembers the pick | Saved searches, task 4 |
| `src/lib/posting-searches.db.test.ts` | Tests for the picked provider | Saved searches, task 4 |
| `src/app/(app)/jobs/actions.ts` | `runJobSearch` takes an optional `source` | Saved searches, task 4 |
| `src/app/(app)/jobs/actions.db.test.ts` | Test for `source` | Saved searches, task 4 |
| `src/app/(app)/jobs/page.tsx` | Passes the providers that are on and JSearch's 30-day count | Saved searches, task 4 |
| `src/app/(app)/jobs/jobs-screen.tsx` | A "Search on" picker among the providers that are on; the Bundesagentur note follows the pick | Saved searches, task 4 |
| `src/app/(app)/jobs/jobs-screen.test.tsx` | Tests for the picker | Saved searches, task 4 |
| `src/lib/connector/tools.ts` | `search_jobs` takes an optional `source` | Saved searches, task 4 |
| `src/lib/connector/tools.db.test.ts` | Test for `source` in `search_jobs` | Saved searches, task 4 |
| `e2e/find-jobs.spec.ts` | The FreeHire test picks it in Find jobs | Saved searches, task 4 |
| `src/lib/settings.ts` | `agentSearches` and `agentSourceCaps` settings | Saved searches, task 5 |
| `src/lib/settings.test.ts` | Tests for the two settings | Saved searches, task 5 |
| `src/lib/settings.ts` | `requests` on each agent run, and 30 runs kept | Saved searches, task 6 |
| `src/lib/agent/runs.ts` | `recordRunStart` records the planned requests | Saved searches, task 6 |
| `src/lib/settings.test.ts` | `AgentRun` fixtures gain `requests: []`, and a test for runs saved without it | Saved searches, task 6 |
| `src/app/(app)/agent/actions.db.test.ts` | `AgentRun` fixtures gain `requests: []` | Saved searches, task 6 |
| `src/lib/agent/run.db.test.ts` | `AgentRun` fixtures gain `requests: []` | Saved searches, task 6 |
| `src/lib/agent/schedule.db.test.ts` | `AgentRun` fixtures gain `requests: []` | Saved searches, task 6 |
| `src/lib/agent/view.db.test.ts` | `AgentRun` fixtures gain `requests: []` | Saved searches, task 6 |
| `prisma/schema.prisma` | `AgentCandidate` gains `searchId`, `searchName` and an index on `searchId` | Saved searches, task 7 |
| `src/lib/data-export.ts` | The `agentCandidate` export schema gains `searchId` and `searchName`, with defaults for older files | Saved searches, task 7 |
| `src/lib/data-import.db.test.ts` | The candidate round trip covers the search tag and files without it | Saved searches, task 7 |
| `src/app/(app)/settings/delete-everything.db.test.ts` | The candidate it deletes carries a search tag | Saved searches, task 7 |
| `src/lib/agent/run.ts` | `agentSetupProblem` takes the settings and config; `runAgentScan` runs every saved search on every provider through the planner; `agentQueryReady` removed | Saved searches, task 8 |
| `src/lib/agent/candidates.ts` | `candidateData` takes the saved search and stores `searchId`/`searchName` | Saved searches, task 8 |
| `src/lib/agent/view.ts` | Calls `agentSetupProblem` with the settings and config | Saved searches, task 8 |
| `src/app/(app)/agent/actions.ts` | `searchReady` in place of `agentQueryReady`; Run now checks setup with the config | Saved searches, task 8 |
| `src/lib/agent/run.db.test.ts` | A fake per provider; tests for several searches and providers, caps, skipped and failing providers | Saved searches, task 8 |
| `src/lib/agent/candidates.db.test.ts` | `candidateData` with a search; test for the search tag | Saved searches, task 8 |
| `src/lib/agent/draft.db.test.ts` | `candidateData` with a search | Saved searches, task 8 |
| `src/lib/agent/view.db.test.ts` | Config fake gains `sourcesOn`; the new setup message | Saved searches, task 8 |
| `src/app/(app)/agent/actions.db.test.ts` | Config fake gains `sourcesOn`; the new setup messages and order | Saved searches, task 8 |
| `src/app/(app)/agent/actions.ts` | `saveAgentSettings` drops `query`; turning the agent on needs a runnable saved search | Saved searches, task 9 |
| `src/app/(app)/agent/actions.db.test.ts` | The turn-on test follows the new rule | Saved searches, task 9 |
| `src/app/(app)/settings/agent-section.tsx` | "What it looks for" card becomes Saved searches and Searches per provider; intro, footer and warning copy | Saved searches, task 9 |
| `src/app/(app)/settings/agent-section.test.tsx` | Tests follow the saved searches, the new copy and the turn-on refusal | Saved searches, task 9 |
| `src/app/(app)/settings/page.tsx` | Passes the saved searches, caps, agent providers and runs to the Job agent section | Saved searches, task 9 |
| `e2e/agent.spec.ts` | Adds a saved search through the new UI before turning the agent on | Saved searches, task 9 |
