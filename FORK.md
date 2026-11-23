# This fork

## What this fork is

PJ's own copy of [AienTech/dossier](https://github.com/AienTech/dossier), used for PJ's job search. It carries
changes that are not meant for upstream and are not offered back.

## Syncing upstream

1. `git fetch upstream --tags`
2. Once per clone: `git config rerere.enabled true`, so a conflict resolved once stays resolved.
3. Merge the release tag into a branch: `git switch -c sync/<tag>` then `git merge <tag>`.
4. Test with `docker/bin/yarn test` (and `typecheck`, `lint`), fix what the merge broke, then merge the branch.

A sync can go in steps (merge one release tag, test, merge the next on top), as 1.11.0 to 1.15.1 did through 1.13.0.
Where the fork's own version of something was replaced by upstream's, take upstream's whole file
(`git checkout <tag> -- <file>`): a half-merged file is worse than either side. Then check the
[files we change](#upstream-files-we-change) below and keep each only while the fork still needs it.

### Two schemas, two migrations

PostgreSQL and SQLite each have their own migrations (`prisma/migrations`, `prisma/sqlite/migrations`), and
`prisma/sqlite/schema.prisma` is made from `prisma/schema.prisma` by `yarn sqlite-schema`: change the first,
run that, then give both databases a migration, and a test checks that the SQLite ones make exactly its schema.
A migration of the fork's gets a timestamp later than every migration in the upstream release it follows a
sync of, so it runs after them on a database that's behind, and it goes in both directories. Test it the way
`src/lib/fork-sync-migration.db.test.ts` does (the real SQL against a minimal schema, on PostgreSQL or SQLite).

Never rebase: the fork's history stays as it is, and each upstream release arrives as one merge.

## Releases

Fork releases are tagged `v<upstream version>-pjd.<fork version>`, for example `v1.11.0-pjd.0.1.0`: the upstream
release the fork is merged up to, then the fork's own semver. A `-` is used because Docker tags can't hold `+`.
`package.json` stays at the upstream version so syncs don't conflict; the fork version lives only in the tag.

1. Merge to `main` and wait for CI to build the image for that commit.
2. Push an annotated tag: `git tag -a v1.11.0-pjd.0.1.0 -m "<notes>"` then `git push origin v1.11.0-pjd.0.1.0`.
3. `.github/workflows/release.yml` tags the image on GHCR (`ghcr.io/pjd-hermes/dossier:<tag>` and `latest`) and
   creates the GitHub release with the tag message as notes. It runs on upstream and this fork only; the
   website workflow (`pages.yml`) and the desktop app's (`desktop.yml`) stay upstream only. Upstream makes the release
   a draft that `desktop.yml` publishes once the desktop downloads are attached; here that never runs, so the release is
   published at once.

Fork versions: `0.1.0` is the first release (upstream 1.11.0 merged, plus saved searches and multi-provider job search). The next one, `0.2.0`, is the release that has upstream 1.15.1 merged: the fork's saved searches, multi-provider job search and OpenCode Go are gone, replaced by upstream's, and a migration moves PJ's data (below). The next one, `0.3.0`, adds access tokens for the MCP endpoint and the tools for checking what the job agent finds (below).

## Rules

1. New logic goes in new files. Upstream files get thin calls into them; no renames, no reformatting.
2. Settings JSON before new tables. Nothing of the fork's touches the Prisma schema now but the one enum value below.
3. Every upstream file changed is listed below with one line on why.
4. Merge upstream release tags, never rebase.

## Upstream files we change

| File | Why | Since |
|---|---|---|
| `.github/workflows/release.yml` | The release job also runs on this fork; the desktop job (and the draft it publishes) stays upstream only | First fork release; again on the 1.15.1 sync |
| `.github/workflows/pages.yml` | The website is published from upstream only | Fork's first workflow change; again on the 1.15.1 sync |
| `.github/workflows/desktop.yml` | The desktop app's downloads are built upstream only | 1.15.1 sync |
| `src/lib/ai/config.ts`, `src/lib/ai/index.ts`, `src/lib/ai/provider-options.ts` | A stray `OPENCODE_GO` (from an export made before the sync) reads as OpenAI-compatible at OpenCode Go's address, because the enum still has the value and these are exhaustive over it | 1.15.1 sync |
| `prisma/schema.prisma`, `prisma/sqlite/schema.prisma` | `OPENCODE_GO` stays in the `AiProvider` enum so a database that had it stays valid. Nothing writes it. The SQLite file is derived (`yarn sqlite-schema`) | 1.15.1 sync |
| `prisma/schema.prisma`, `prisma/sqlite/schema.prisma` | `Posting.vetting`: what was found out about whether a posting is real (see "Access tokens and vetting" below) | Tokens and vetting |
| `src/app/api/mcp/route.ts` | Tries a named access token before OAuth, and passes its name and scope on | Tokens and vetting |
| `src/lib/connector/tools.ts` | Two thin calls: `limitTools` (what a token may use) and `registerVettingTools` (the five new tools) | Tokens and vetting |
| `src/lib/settings.ts`, `src/lib/data-export.ts`, `src/lib/data-import.ts` | `connectorTokens` and `connectorTokenUse` settings (kept out of exports); `vetting` carried through export and import, without a format version bump so upstream's numbering stays its own | Tokens and vetting |
| `src/lib/job-search/search.ts`, `src/lib/postings.ts` | `PostingState.vetting`, there only when a verdict exists, so a state reads as upstream's without one | Tokens and vetting |
| `src/app/(app)/settings/page.tsx`, `connector-section.tsx` | One call each: the access tokens card inside Settings → MCP connector | Tokens and vetting |
| `src/app/(app)/jobs/posting-results.tsx` | A tag and a "Checked" fact for a posting's verdict | Tokens and vetting |

## Files only this fork has

| File | What it is |
|---|---|
| `FORK.md`, `.project/` | This file, and the plans and roadmap |
| `prisma/migrations/20261027090000_ai_provider_opencode_go`, `20261030090000_agent_candidate_search` | The fork's two old migrations. Databases of the fork have run them, so they stay; the one below undoes the second |
| `prisma/migrations/20261126090000_fork_upstream_sync`, `prisma/sqlite/migrations/20261126090000_fork_upstream_sync` | The 1.15.1 sync (see below) |
| `src/lib/fork-sync-migration.db.test.ts` | Tests that migration, on whichever database the tests run on |
| `src/lib/ai/retired-provider.test.ts` | Tests that a stray `OPENCODE_GO` still works |
| `src/dependency-floor.test.ts` | Fails if the installed `next` or `sharp` is older than the floors set by their advisories |
| `prisma/migrations/20261201090000_posting_vetting`, `prisma/sqlite/migrations/20261201090000_posting_vetting` | `Posting.vetting` (JSON, nullable) |
| `src/lib/connector/tokens.ts`, `scopes.ts`, `vetting-tools.ts` (and their tests) | Named access tokens, which tools a token may use, and the five tools |
| `src/lib/vetting.ts`, `vetting-shape.ts`, `agent-finds.ts` (and their tests) | Record a verdict, dismiss with a reason, restore; the verdict's shape and wording; what the agent's runs found and a company's history |
| `src/app/(app)/settings/connector-token-actions.ts`, `connector-tokens.tsx` (and tests) | The access tokens card in Settings → MCP connector |

## The 1.15.1 sync migration

Upstream's 1.13 to 1.15 do what the fork's saved searches, multi-provider job search and OpenCode Go did, in their
own way: up to three Agent searches (`AgentSearch`, with `AgentCandidateSearch` for which search found a candidate),
portals with their own agent limits, and OpenCode as one of the OpenAI-compatible servers. So the sync took upstream's
code for all of it, and `20261126090000_fork_upstream_sync` moves PJ's data first. It's one migration for each database
(SQLite has no candidate columns to convert, so its half is settings only):

- **Saved searches:** the setting `agentSearches` (up to five) becomes `AgentSearch` rows, keeping ids and order. Upstream
  holds three, so the first three that it can hold (an id, and keywords) are kept; the others are saved as they were in the
  setting `agentSearchesDropped`, which nothing reads. The search made from the old single query (`agent-search-legacy`)
  goes when a list was saved, as the list was then the whole list.
- **Candidate tags:** `AgentCandidate.searchId` and `searchName` become `AgentCandidateSearch` rows (a dropped or removed
  search keeps its name and loses its id), then the two columns and their index are dropped.
- **OpenCode Go:** a saved provider `OPENCODE_GO` becomes `OPENAI`, with the address `https://opencode.ai/inference/go/v1`
  (or the saved one, made to end in `/v1`) and the model `glm-5.3-flash` unless one was saved. The key is untouched.
  An environment with `DOSSIER_AI_PROVIDER=opencode-go` has to change to `openai` and the address above: upstream doesn't know the old name.
- **Job providers:** `jobSourcesOn`, `jobSourceUsage` and `agentSourceCaps` are deleted. Upstream reads the provider keys
  (`jsearchKeyEnc`, `adzunaKeyEnc`, `adzunaAppId`) and the one source (`jobSource`) into its portals by itself, so nothing is
  lost there; of the providers that were on together the first becomes `jobSource` (when none was chosen), and the others
  are switched on again in Settings -> Job search.

## Access tokens and vetting

For n8n and other apps that can't sign in through OAuth, and for checking what the job agent finds
(plan: `.project/plans/2026-11-22-mcp-token-and-agent-finds.md`).

- **Tokens:** Settings → MCP connector → Access tokens. A name and a scope (`read`, or `dismiss`), shown once, kept as a
  SHA-256 hash in the `connectorTokens` setting, revoked one by one. They work while the connector is on; "Disconnect all
  apps" doesn't revoke them (it's for OAuth apps). `read` sees only the tools that look; `dismiss` also `record_vetting`,
  `dismiss_posting` and `restore_posting`. Claude's own sign-in keeps every tool.
- **Tools:** `list_agent_finds` (what agent runs found, with `since` for what's new after a run), `company_history`,
  `record_vetting` (legit, doubtful or scam, with a note and checks), `dismiss_posting` (records why, then dismisses, as the
  Dismiss button does; a posting the user saved or applied for is left alone) and `restore_posting` (Undo). They go through `postings.ts`, so there is one dismissal.
- **Verdicts** are kept in `Posting.vetting` and shown in Positions (a tag, and a Checked line in the facts).
- **n8n:** add an MCP Client node, endpoint `<your address>/api/mcp`, header `Authorization: Bearer dsr_...`. After each agent
  run: `list_agent_finds` with `since` and `only_unvetted`, check each posting (`get_posting`, `company_history`, web checks in
  n8n), `record_vetting` for each, and `dismiss_posting` for the scams.

## Kept on purpose

- Nothing at the moment. (`saveJobSource` and `testJobSource` in `settings/actions.ts`, kept before, came from the fork's
  multi-provider search and went with it.)
