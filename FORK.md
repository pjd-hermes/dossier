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
