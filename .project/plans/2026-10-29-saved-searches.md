# Several Providers and Saved Searches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Dossier search several job providers at once and let the job agent run up to 5 saved searches
(one per job type) on every provider that's on, within a per-provider daily cap, with each agent posting
tagged by the search that found it.

**Architecture:** The provider choice and the saved searches live in Settings JSON (no new tables). New
logic sits in new files (`providers-on.ts`, `usage.ts`, `agent/search-schema.ts`, `agent/searches.ts`,
`agent/plan.ts`, new UI components and action files); upstream files get thin calls into them. One
Prisma migration adds the search tag to `AgentCandidate`. The agent run asks a pure planner which
(search, provider) pairs to request, then scores a fair share of each search's new postings.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 / PostgreSQL, zod 4, Vitest 5 + Testing Library,
Playwright, Yarn 4.

**Spec:** [2026-10-29-saved-searches-design.md](2026-10-29-saved-searches-design.md). Mockups:
https://claude.ai/artifact/E8uhVJUJiWec5gxv1cx838. Read both before starting a task.

## Global Constraints

- Feature branch `claude/project-thread-ug5ge7` only. Commit and push after each task. **Never open a pull
  request**; PJ opens it when PJ says it's ready.
- Fork rules (spec, "Design rules for the fork"): new logic in new files; upstream files get small, targeted
  edits; no renames or reformatting of upstream code. Every upstream file a task changes gets one line in
  `FORK.md` (Task 1 creates it) in that task's commit.
- Settings JSON, not new tables. The only Prisma change is Task 7's.
- Limits, copied from the spec: at most **5** saved searches; caps per provider are `0 | 1 | 2 | 3 | 4 | 5 | "all"`;
  default caps `{ JSEARCH: 2 }` (a provider not listed means `"all"`); the Bundesagentur für Arbeit is never
  searched by the agent; `AGENT_MAX_RUNS_PER_DAY` stays 3; Run now's one-hour wait stays; `AGENT_RUNS_KEPT`
  becomes 30; usage is kept for 31 days and shown for the past 30.
- Every Server Action is defined with `action()` (enforced by `src/lib/session-audit.test.ts`).
- Coverage gates in `vitest.config.mts` are hard: 86 % lines overall, 94 % for `src/lib/**`. Don't lower them.
- Copy style: follow the existing UI copy (plain sentences, "you", no exclamation marks, en dash only in ranges).
  Exact strings given in this plan are required; tests assert them.
- Commands: `docker/bin/yarn <cmd>` on PJ's machine. In the cloud container use `/tmp/claude-0/bin/dyarn <cmd>`
  (Node 24, Yarn 4.18.1, local Postgres 16; see "Cloud container toolchain" at the end). Never claim a run that
  didn't happen.
- The repository is public. No personal data in any file, test fixture or commit message: no real names
  beyond "PJ", no addresses, emails, phone numbers, IPs or hostnames of PJ's machines. Use made-up sample
  data ("Jane Doe", "Rotterdam", "example.com") as the existing tests do. Check the diff before each push.
- Commit messages: imperative, sentence case, like the existing history; end with the session's attribution
  lines.

## Review Focus

1. **Upgrading an existing install.** Settings saved before this step (`jobSource: "JSEARCH"`, an `agentQuery`
   with keywords, no `jobSourcesOn`, no `agentSearches`) must give JSearch on, Find jobs on JSearch, and one
   saved search with the old query, enabled. Pinned in Task 1 (config) and Task 5 (searches).
2. **A provider whose key is missing or unreadable** while it's on. The run skips it with a note and searches
   the others; its cap isn't spent. Pinned in Task 8.
3. **Run now soon after a capped run.** JSearch with cap 2 already used twice in the past 24 h: Run now must
   not ask JSearch, must still ask the others, and must say why. Pinned in Task 6 (planner) and Task 8 (run).
4. **A saved search whose country a provider doesn't cover** (Adzuna's 19 countries). That pair is left out
   and doesn't count against the cap. Pinned in Task 6.
5. **Removing a saved search that has postings in the queue.** The postings keep their tag, shown from
   `searchName`, and still filter. Pinned in Task 10.

---

### Task 1: Several providers on at once (config) and FORK.md

**Files:**
- Create: `FORK.md`
- Create: `src/lib/job-search/providers-on.ts`, `src/lib/job-search/providers-on.test.ts`
- Modify: `src/lib/settings.ts` (add `jobSourcesOn` next to `jobSource`)
- Modify: `src/lib/job-search/config.ts` (`JobSearchConfig`, `SavedJobSettings`, `resolveJobSearchConfig`, `jobSearchView`)
- Modify: `src/lib/job-search/sources.ts` (`JobSearchSettingsView` gains `sourcesOn`)
- Test: `src/lib/job-search/config.test.ts`, `src/lib/settings.test.ts`

**Interfaces:**
- Produces:
  - Setting `jobSourcesOn: JobSource[] | null` (`json(z.array(z.enum(JOB_SOURCES))).nullable().catch(null)`).
  - `JobSearchConfig.sourcesOn: JobSource[]` (in `JOB_SOURCES` order, no duplicates, no Bundesagentur while the
    server doesn't offer it). `JobSearchConfig.source` keeps its name and now means **Find jobs' provider**:
    the saved/env choice when it's in `sourcesOn`, else `sourcesOn[0] ?? null`.
  - `JobSearchSettingsView.sourcesOn: JobSource[]`.
  - `providers-on.ts`: `agentSources(config: JobSearchConfig): JobSource[]` (`sourcesOn` without
    `ARBEITSAGENTUR`); `sourceProblem(config: JobSearchConfig, source: JobSource): string | null` (the
    `JobSearchError` message `credentialsFor` throws, else null; other errors rethrown).

- [ ] **Step 1: Write `FORK.md`**

Sections: "What this fork is" (PJ's job search; fork of AienTech/dossier; not upstreamed), "Syncing upstream"
(fetch `upstream`, `git config rerere.enabled true`, merge the release tag into `sync/<tag>`, test with
`docker/bin/yarn test`, merge; never rebase), "Rules" (the four fork rules from the spec), and a table
"Upstream files we change" with columns File · Why · Since, seeded with the 1.10.0 merge's conflicts
(`src/lib/env.ts` OpenCode Go provider, `src/lib/ai/providers.live.test.ts`, `DEVELOPMENT.md`) and this task's files.

- [ ] **Step 2: Write the failing tests**

In `config.test.ts`, `describe("sourcesOn")`:
- `resolveJobSearchConfig({ ...saved, jobSource: "JSEARCH", jobSourcesOn: null }, env)` → `sourcesOn` `["JSEARCH"]`, `source` `"JSEARCH"`.
- `jobSource: null, jobSourcesOn: null`, env `DOSSIER_JOBS_SOURCE: "adzuna"` → `sourcesOn` `["ADZUNA"]`.
- `jobSource: "OFF", jobSourcesOn: null` → `sourcesOn` `[]`, `source` `null`.
- `jobSourcesOn: ["FREEHIRE", "JSEARCH", "JSEARCH"]`, `jobSource: "ADZUNA"` → `sourcesOn` `["JSEARCH", "FREEHIRE"]`, `source` `"JSEARCH"`.
- `jobSourcesOn: ["ARBEITSAGENTUR", "FREEHIRE"]`, env `DOSSIER_JOBS_ARBEITSAGENTUR: "off"` → `sourcesOn` `["FREEHIRE"]`.
- `jobSearchView(config).sourcesOn` equals `config.sourcesOn`.

In `providers-on.test.ts`: `agentSources` drops `ARBEITSAGENTUR`; `sourceProblem` returns the "no-key"
message for JSearch without a key, `null` for FreeHire.

In `settings.test.ts`: `jobSourcesOn` parses `'["JSEARCH"]'`, and falls back to `null` for `'nonsense'` and
for `'["NOPE"]'`.

Update existing `config.test.ts` fixtures for the new `jobSourcesOn` field (add `jobSourcesOn: null`).

- [ ] **Step 3: Run them to see them fail**

Run: `docker/bin/yarn vitest run src/lib/job-search/config.test.ts src/lib/job-search/providers-on.test.ts src/lib/settings.test.ts`
Expected: FAIL (`sourcesOn` undefined, module `./providers-on` not found).

- [ ] **Step 4: Implement**

Add the setting, the config field and the view field per Interfaces. `providers-on.ts` starts with
`import "server-only"` (it uses `credentialsFor`).

- [ ] **Step 5: Run the tests, then typecheck**

Run: the Step 3 command, then `docker/bin/yarn typecheck`
Expected: PASS; typecheck clean (fix any caller that builds a `JobSearchConfig` or `JobSearchSettingsView`
literal, e.g. test fixtures, by adding the new field).

- [ ] **Step 6: Commit**

```bash
git add FORK.md src/lib/settings.ts src/lib/settings.test.ts src/lib/job-search
git commit -m "Let several job providers be on at once"
```

---

### Task 2: Count requests per provider

**Files:**
- Create: `src/lib/job-search/usage.ts`, `src/lib/job-search/usage.test.ts` (pure, no `server-only`)
- Create: `src/lib/job-search/usage-store.ts`, `src/lib/job-search/usage-store.db.test.ts`
- Modify: `src/lib/settings.ts` (add `jobSourceUsage`)
- Modify: `src/lib/data-export.ts` (`INSTALL_SETTINGS` gains `"jobSourceUsage"`)
- Modify: `src/lib/job-search/index.ts` (one `countRequest` call each in `searchPostings`, `postingDetails`, `testSource`, after the cache check)
- Test: `src/lib/job-search/index.test.ts` (mock `./usage`)

**Interfaces:**
- Produces:
  - Setting `jobSourceUsage: JobSourceUsage`, default `{}`, where
    `type JobSourceUsage = Partial<Record<JobSource, Record<string, number>>>` (keys `"YYYY-MM-DD"`, UTC).
  - `usage.ts` (no `server-only`, pure part importable by client code):
    `trimUsage(usage: JobSourceUsage, now: Date): JobSourceUsage` (drops days older than 31 days);
    `requestsInPastDays(usage: JobSourceUsage, source: JobSource, days: number, now: Date): number`;
    `MONTHLY_QUOTA: Partial<Record<JobSource, number>> = { JSEARCH: 200 }`;
    `usageLine(source: JobSource, used: number): string | null` → `"Used in the past 30 days: 41 of 200 (counted by Dossier)"`
    for JSearch, `"Used in the past 30 days: 12 (counted by Dossier)"` for Adzuna, `null` for providers whose
    `SOURCE_INFO[source].quotaPeriod` is null.
  - `usage-store.ts` (`import "server-only"`):
    `countRequest(source: JobSource, now = new Date()): Promise<void>` — loads settings, increments today's
    count, trims, saves. It never throws: failures go to `logServerError("job search usage", error)`.

- [ ] **Step 1: Write the failing tests**

`usage.test.ts`: `trimUsage` keeps `2026-10-01` and drops `2026-09-28` at `now = 2026-10-31T12:00:00Z`;
`requestsInPastDays(usage, "JSEARCH", 30, now)` sums only days within 30 days; `usageLine` returns the three
exact strings above.
`usage-store.db.test.ts`: two `countRequest("JSEARCH", now)` calls and one for `"ADZUNA"` leave
`jobSourceUsage` `{ JSEARCH: { "2026-10-31": 2 }, ADZUNA: { "2026-10-31": 1 } }`; with `saveSettings` mocked
to throw, `countRequest` resolves and logs.
`index.test.ts`: a cache hit doesn't call `countRequest`; a miss calls it once with the source, also when
the adapter throws.
`data-export.db.test.ts`: an export leaves `jobSourceUsage` out (extend the existing install-settings case).

- [ ] **Step 2: Run them to see them fail**

Run: `docker/bin/yarn vitest run src/lib/job-search/usage.test.ts src/lib/job-search/usage-store.db.test.ts src/lib/job-search/index.test.ts src/lib/data-export.db.test.ts`
Expected: FAIL (modules missing; `countRequest` not called).

- [ ] **Step 3: Implement per Interfaces**

Schema: `json(z.partialRecord(z.enum(JOB_SOURCES), z.record(z.string(), z.number().int().min(0)))).catch({})`.
A lost increment from two simultaneous requests is acceptable (spec); no locking.

- [ ] **Step 4: Run the tests again**

Expected: PASS.

- [ ] **Step 5: Commit** (add the `FORK.md` lines for `settings.ts`, `data-export.ts`, `index.ts`)

```bash
git add src/lib/job-search src/lib/settings.ts src/lib/settings.test.ts src/lib/data-export.ts src/lib/data-export.db.test.ts FORK.md
git commit -m "Count the requests Dossier sends to each job provider"
```

---

### Task 3: Settings → Job search with a card per provider

**Files:**
- Create: `src/app/(app)/settings/provider-actions.ts`, `src/app/(app)/settings/provider-actions.db.test.ts`
- Modify: `src/lib/job-search/config.ts` (`jobSearchView(config, usage = {}, now = new Date())` adds `usage`)
- Modify: `src/lib/job-search/sources.ts` (`JobSearchSettingsView.usage: Partial<Record<JobSource, number>>`, past 30 days)
- Modify: `src/app/(app)/settings/actions.ts` (`loadView` passes `(await loadSettings()).jobSourceUsage`)
- Modify: `src/app/(app)/settings/page.tsx` (same for the initial view)
- Modify: `src/app/(app)/settings/job-search-section.tsx` (rewrite the body in place; keep `HostChoice`, `KeyField`, `ArbeitsagenturNote`, `ConnectionStatus`)
- Test: `src/app/(app)/settings/job-search-section.test.tsx`, `e2e/find-jobs.spec.ts` (Settings part)

**Interfaces:**
- Consumes: Task 1 `sourcesOn`; Task 2 `requestsInPastDays`, `usageLine`.
- Produces (in `provider-actions.ts`, `"use server"`, each via `action()`, each returning `JobSearchSettingsView`):
  - `setJobSourceOn({ source: JobSource, on: boolean, accepted?: true })`: writes the whole `jobSourcesOn`
    list (starting from `config.sourcesOn`). Turning the Bundesagentur on keeps today's rules: not offered →
    `ActionError("The Bundesagentur für Arbeit isn't offered on this server.")`; note not accepted and
    `accepted` absent → `ActionError("Tick “I understand” under the note about the Bundesagentur für Arbeit first.")`;
    `accepted: true` also saves `arbeitsagenturAcceptedAt`. Keys are never touched.
  - `testJobSourceOf({ source: JobSource })` → `{ connected: true, seconds } | { connected: false, message }`,
    the same shape as `testJobSource`, for that provider.
  - Existing `saveJobSource`, `testJobSource`, `saveJobSearchDetails`, `saveJobSourceKey` stay as they are.

- [ ] **Step 1: Write the failing tests**

`provider-actions.db.test.ts`: turning FreeHire on with JSearch saved as `jobSource` gives
`sourcesOn: ["JSEARCH", "FREEHIRE"]`; turning JSearch off keeps `jsearchKeyEnc`; the two Bundesagentur errors
above; `testJobSourceOf({ source: "FREEHIRE" })` with the adapter mocked returns `connected: true`.
`job-search-section.test.tsx` (replace the radio tests): one card per provider in `JOB_SOURCES` order with a
switch named `Use JSearch` (etc.); switching calls `setJobSourceOn`; JSearch's card shows the host choice and
the key field, Adzuna's the App ID and key, FreeHire's "No key needed…" text, each card has its own
"Test connection" that calls `testJobSourceOf` with its source and shows its own result; the usage line
`Used in the past 30 days: 41 of 200 (counted by Dossier)` under JSearch when `usage.JSEARCH` is 41; with
nothing on, the note `Find jobs and the job agent stay off until you turn a provider on.` shows and the
"go to … only" warning does not.
Intro copy (exact): `Where Find jobs and the job agent look for postings. Turn on as many providers as you like; each keeps its own key, and a key only ever goes to the provider it's for.`
Warning copy with one or more on (exact): `Your searches (keywords, place and filters) go to each provider that's on. Nothing from your profile does.`
Bundesagentur card description adds: `Find jobs only: the job agent never searches it.`

- [ ] **Step 2: Run them to see them fail**

Run: `docker/bin/yarn vitest run "src/app/(app)/settings/provider-actions.db.test.ts" "src/app/(app)/settings/job-search-section.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implement the actions and the section**

Layout and spacing as in the mockup's "Settings → Job search" board, built from the existing `Card`, `Toggle`
(or the switch it wraps), `Button`, `Input`, `SegmentedControl`. Each card keeps its own `Connection` state;
any change on a card resets only that card's test result. A card that's off shows its description and switch
only (keys stay saved).

- [ ] **Step 4: Update `e2e/find-jobs.spec.ts`'s Settings test**

Replace `getByRole("radio", { name: … })` with the switches (`getByRole("switch", { name: "Use FreeHire" })`)
and the card's own "Test connection".

- [ ] **Step 5: Run the unit tests, typecheck and lint**

Run: Step 2's command, `docker/bin/yarn typecheck`, `docker/bin/yarn lint`
Expected: PASS, clean.

- [ ] **Step 6: Commit** (plus `FORK.md` lines)

```bash
git add -A "src/app/(app)/settings" src/lib/job-search e2e/find-jobs.spec.ts FORK.md
git commit -m "Show a card per job provider in Settings, each with its own switch and test"
```

---

### Task 4: Find jobs picks among the providers that are on; the Claude connector too

**Files:**
- Modify: `src/lib/posting-searches.ts` (`runSearch(query, source?)`)
- Modify: `src/app/(app)/jobs/actions.ts` (`runJobSearch` input gains `source: z.enum(JOB_SOURCES).optional()`)
- Modify: `src/app/(app)/jobs/page.tsx`, `src/app/(app)/jobs/jobs-screen.tsx`, `src/app/(app)/jobs/search-fields.tsx` (picker)
- Modify: `src/lib/connector/tools.ts` (`search_jobs` input gains `source`)
- Test: `src/lib/posting-searches.db.test.ts`, `src/app/(app)/jobs/actions.db.test.ts`, `src/app/(app)/jobs/jobs-screen.test.tsx`, `src/lib/connector/tools.db.test.ts`, `e2e/find-jobs.spec.ts`

**Interfaces:**
- Consumes: Task 1 `sourcesOn` and `source`; Task 2 `requestsInPastDays`.
- Produces:
  - `runSearch(query: SearchQuery, source?: JobSource)`: with `source` not in `config.sourcesOn` →
    `{ ok: false, problem: "off", message: "Turn JSearch on in Settings → Job search first." }` (provider name
    from `SOURCE_INFO`); on success with `source` given, saves `jobSource: source` so the picker remembers it.
    Without `source`, Find jobs' provider as today. `showMoreFor` is unchanged (a kept search goes on with its
    own provider).
  - `search_jobs` tool: `source: z.enum(["jsearch", "adzuna", "freehire", "arbeitsagentur"]).optional()`
    described as `"Which provider to search; one that's on in Settings → Job search. Defaults to the one Find jobs uses."`, mapped to upper case.

- [ ] **Step 1: Write the failing tests**

`posting-searches.db.test.ts`: `runSearch(query, "ADZUNA")` with only JSearch on returns the "Turn Adzuna on…"
problem and sends nothing; with both on it searches Adzuna, keeps the search with `source: "ADZUNA"` and saves
`jobSource: "ADZUNA"`.
`jobs-screen.test.tsx`: with `sources={["JSEARCH","FREEHIRE"]}` a radio group labelled `Search on` shows
both, `JSearch` checked; picking FreeHire and searching calls `runJobSearch` with `source: "FREEHIRE"`; with one
provider on, no picker; the hint under the picker for JSearch reads `JSearch: 41 of 200 used in the past 30 days.`
`tools.db.test.ts`: `search_jobs` with `source: "freehire"` searches FreeHire.

- [ ] **Step 2: Run them to see them fail**

Run: `docker/bin/yarn vitest run src/lib/posting-searches.db.test.ts "src/app/(app)/jobs" src/lib/connector/tools.db.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

The page passes `sources={config.sourcesOn}`, `source={config.source}` and the JSearch 30-day count. The
screen holds the picked provider in state (initially `source`) and passes it to `SearchFields`'s existing
`source` prop, so the distance and remote hints follow the pick. Use `SegmentedControl` with
`aria-label="Search on"`.

- [ ] **Step 4: Update `e2e/find-jobs.spec.ts`** for the picker where a test switches providers.

- [ ] **Step 5: Run the tests, typecheck, lint** — Expected: PASS, clean.

- [ ] **Step 6: Commit** (plus `FORK.md` lines)

```bash
git commit -am "Pick the provider to search in Find jobs and from Claude"
```

---

### Task 5: Saved searches and caps in Settings

**Files:**
- Create: `src/lib/agent/search-schema.ts` (no `server-only`), `src/lib/agent/search-schema.test.ts`
- Create: `src/lib/agent/searches.ts`, `src/lib/agent/searches.test.ts`
- Modify: `src/lib/settings.ts` (add `agentSearches`, `agentSourceCaps`)
- Test: `src/lib/settings.test.ts`

**Interfaces:**
- Produces, in `search-schema.ts`:
  ```ts
  export const MAX_AGENT_SEARCHES = 5;
  export const agentSearchSchema = searchQuerySchema.extend({
    id: z.string().min(1).max(40),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
  });
  export type AgentSearch = z.output<typeof agentSearchSchema>;
  export const SOURCE_CAPS = [0, 1, 2, 3, 4, 5, "all"] as const;
  export type SourceCap = (typeof SOURCE_CAPS)[number];
  export const sourceCapsSchema = z.partialRecord(z.enum(JOB_SOURCES), z.union([z.literal([0, 1, 2, 3, 4, 5]), z.literal("all")]));
  export type SourceCaps = z.output<typeof sourceCapsSchema>;
  export const DEFAULT_SOURCE_CAPS: SourceCaps = { JSEARCH: 2 };
  ```
- Produces, settings: `agentSearches: json(z.array(agentSearchSchema).max(MAX_AGENT_SEARCHES)).nullable().catch(null)`,
  `agentSourceCaps: json(sourceCapsSchema).catch(DEFAULT_SOURCE_CAPS)`.
- Produces, in `searches.ts` (pure, no `server-only`, so the settings UI can use it):
  - `searchesOf(settings: Pick<SettingsData, "agentSearches" | "agentQuery" | "agentEnabled">): AgentSearch[]` —
    `agentSearches` when not null; else, when `agentQuery.keywords` is set,
    `[{ ...agentQuery, id: "legacy", name: agentQuery.keywords.slice(0, 80), enabled: true }]`; else `[]`.
  - `searchReady(search: SearchQuery): boolean` — keywords and a country (replaces `agentQueryReady`).
  - `runnableSearches(searches: readonly AgentSearch[]): AgentSearch[]` — enabled and ready, in list order.
  - `capOf(caps: SourceCaps, source: JobSource): SourceCap` — `0` for `ARBEITSAGENTUR`, `caps[source] ?? "all"`.
  - `newSearchId(): string` — `crypto.randomUUID().slice(0, 12)`.

- [ ] **Step 1: Write the failing tests** — `searchesOf` for the three cases (Review Focus 1);
  `runnableSearches` drops a paused search and one without a country; `capOf` for JSearch default 2, Adzuna
  `"all"`, Bundesagentur 0 even when stored as `"all"`; settings parse/fallback for both keys (a 6-item list
  falls back to `null`; `{ JSEARCH: 9 }` falls back to the default).
- [ ] **Step 2: Run them to see them fail** — `docker/bin/yarn vitest run src/lib/agent/search-schema.test.ts src/lib/agent/searches.test.ts src/lib/settings.test.ts` → FAIL.
- [ ] **Step 3: Implement per Interfaces.**
- [ ] **Step 4: Run the tests again** → PASS. `docker/bin/yarn typecheck` → clean.
- [ ] **Step 5: Commit** — `git commit -m "Keep up to five saved searches and a daily cap per provider in Settings"` (with `FORK.md`).

---

### Task 6: The request planner and fair scoring pick

**Files:**
- Create: `src/lib/agent/plan.ts` (pure, no `server-only`), `src/lib/agent/plan.test.ts`
- Modify: `src/lib/settings.ts` (`agentRunSchema` gains `requests`; `AGENT_RUNS_KEPT = 30`)
- Modify: `src/lib/agent/runs.ts` (`recordRunStart(now, manual, requests)`)
- Test: `src/lib/agent/schedule.db.test.ts` / `run.db.test.ts` fixtures that build `AgentRun` literals

**Interfaces:**
- Consumes: Task 5 `AgentSearch`, `SourceCaps`, `capOf`; `sourceCovers` from `src/lib/job-search/sources.ts`.
- Produces:
  ```ts
  // settings.ts
  agentRunSchema = z.object({ at, manual, message, requests: z.array(z.object({ source: z.enum(JOB_SOURCES), searchId: z.string() })).default([]) });

  // plan.ts
  export type PlannedRequest = { source: JobSource; searchId: string };
  export type SkippedSource = { source: JobSource; reason: "cap"; cap: number; searchIds: string[] };
  export function planRequests(input: {
    searches: readonly AgentSearch[];   // runnable, in list order
    sources: readonly JobSource[];      // agent sources with credentials, in JOB_SOURCES order
    caps: SourceCaps;
    runs: readonly AgentRun[];          // newest first, as stored
    now: Date;
  }): { requests: PlannedRequest[]; skipped: SkippedSource[] };
  export function pickToScore<T extends { postedAt: string | null }>(
    bySearch: ReadonlyMap<string, readonly T[]>, order: readonly string[], max: number,
  ): { searchId: string; posting: T }[];
  ```
  Planner rules (spec, Data flow step 3): per source, `remaining = cap − requests to it in runs whose `at` is
  less than 24 h before `now`` (`"all"` = number of searches; `0` = source not planned, not reported as
  skipped); candidates are the searches whose country the source covers (`sourceCovers`), ordered by the last
  run that requested (source, search) — never first, then oldest — ties in list order; take `remaining`;
  searches left out because of the cap go in `skipped` with `reason: "cap"`. Output `requests` grouped by
  search in list order, and within a search in `sources` order.
  `pickToScore`: within each search newest `postedAt` first (null last); then one per search in `order`, round
  after round, until `max` or all lists are empty.

- [ ] **Step 1: Write the failing tests** (`plan.test.ts`):
  - three searches, sources `[JSEARCH, ADZUNA, FREEHIRE]`, default caps, no runs → 8 requests: Adzuna and
    FreeHire for all three, JSearch for searches 1 and 2; `skipped` `[{ source: "JSEARCH", reason: "cap", cap: 2, searchIds: ["s3"] }]`.
  - same, with one run 20 h ago that requested JSEARCH for s1 and s2 → no JSearch requests (Review Focus 3).
  - same run 25 h ago → JSearch for `["s1", "s3"]` in output order: s3 never ran on JSearch so it's picked
    first, and s1 and s2 tie (same run) so list order picks s1; output is grouped in list order.
  - `{ JSEARCH: 0 }` → no JSearch requests, nothing in `skipped`.
  - s2 with `country: "ie"` (not in `SOURCE_INFO.ADZUNA.countries`) and caps `{ JSEARCH: 2, ADZUNA: 2 }` → no
    Adzuna request for s2, and Adzuna's two go to s1 and s3 (Review Focus 4).
  - `pickToScore` with s1 = 5 postings, s2 = 1, s3 = 2, `max` 5 → s1 newest, s2, s3 newest, s1 2nd, s3 2nd.
  - `pickToScore` puts `postedAt: null` last within a search.
- [ ] **Step 2: Run them to see them fail** — `docker/bin/yarn vitest run src/lib/agent/plan.test.ts` → FAIL.
- [ ] **Step 3: Implement** `planRequests`, `pickToScore`, the schema change and `recordRunStart(now: Date, manual: boolean, requests: PlannedRequest[] = [])`.
- [ ] **Step 4: Run the tests and the agent DB tests** — `docker/bin/yarn vitest run src/lib/agent src/lib/settings.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Plan which saved searches go to which provider on each run"`.

---

### Task 7: Tag agent postings with their search (migration and data paths)

**Files:**
- Modify: `prisma/schema.prisma` (`AgentCandidate`)
- Create: `prisma/migrations/20261030090000_agent_candidate_search/migration.sql`
- Modify: `src/lib/data-export.ts` (`agentCandidate` schema), `src/lib/data-import.ts` (no change expected beyond types; verify)
- Test: `src/lib/data-export.db.test.ts`, `src/lib/data-import.db.test.ts`, `src/app/(app)/settings/delete-everything.db.test.ts`

**Interfaces:**
- Produces: `AgentCandidate.searchId String?`, `AgentCandidate.searchName String @default("")`,
  `@@index([searchId])`, with the doc comments from the spec. Export schema:
  `searchId: text.nullable().default(null)`, `searchName: text.default("")`.

- [ ] **Step 1: Write the failing tests** — an export with a candidate carrying `searchId: "s1", searchName: "Database Admin"`
  re-imports with both; an export file without the two fields (as written before this step) imports with
  `searchId: null, searchName: ""`; delete-everything leaves no candidates (existing assertion, now with a tagged one).
- [ ] **Step 2: Run them to see them fail** — `docker/bin/yarn vitest run src/lib/data-export.db.test.ts src/lib/data-import.db.test.ts "src/app/(app)/settings/delete-everything.db.test.ts"` → FAIL.
- [ ] **Step 3: Add the fields and the migration**

```sql
-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN "searchId" TEXT,
ADD COLUMN "searchName" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "AgentCandidate_searchId_idx" ON "AgentCandidate"("searchId");
```

Then `docker/bin/yarn prisma generate` and `docker compose restart app` (cloud: `dyarn prisma generate`).
Confirm with `docker/bin/yarn prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
that nothing is left to migrate (needs the shadow DB; skip and say so if it isn't available).

- [ ] **Step 4: Run the tests again** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Keep which saved search found each agent posting"` (with `FORK.md`).

---

### Task 8: The agent run uses saved searches, every provider and the planner

**Files:**
- Modify: `src/lib/agent/run.ts` (`agentSetupProblem`, `runAgentScan`; remove `agentQueryReady`, re-export `searchReady` if callers need it)
- Modify: `src/lib/agent/candidates.ts` (`candidateData(posting, score, search)`)
- Create: `src/lib/agent/run-message.ts`, `src/lib/agent/run-message.test.ts`
- Modify callers of `agentSetupProblem` / `agentQueryReady`: `src/lib/agent/view.ts`, `src/app/(app)/agent/actions.ts`
- Test: `src/lib/agent/run.db.test.ts` (rework the fake source into one fake per provider), `src/lib/agent/candidates.db.test.ts`

**Interfaces:**
- Consumes: Task 1 `agentSources`, `sourceProblem`; Task 5 `searchesOf`, `runnableSearches`; Task 6 `planRequests`,
  `pickToScore`, `recordRunStart(now, manual, requests)`; Task 7 candidate fields.
- Produces:
  - `agentSetupProblem(settings: SettingsData, config: JobSearchConfig): Promise<string | null>` with these
    exact messages, checked in this order:
    `"Add a saved search in Settings → Job agent first."` (no runnable search);
    `"Turn on JSearch, Adzuna or FreeHire in Settings → Job search first."` (no agent source on);
    `"Choose an AI provider in Settings → AI provider first."` (unchanged).
    Missing keys are not setup problems any more.
  - `candidateData(posting: FoundPosting, score: {...}, search: { id: string; name: string }): Prisma.AgentCandidateCreateInput`.
  - `run-message.ts`: `searchedSentence(counts: readonly [JobSource, number][], capped: readonly SkippedSource[]): string`
    and `runMessage(parts: { searched: string; problems: string[]; tail: string }): string` joining with spaces.
    Exact outputs the tests pin:
    - all equal: `[["JSEARCH",3],["ADZUNA",3],["FREEHIRE",3]]`, none capped → `"Searched 3 job types on JSearch, Adzuna and FreeHire."`
    - mixed with cap: `[["JSEARCH",2],["ADZUNA",3],["FREEHIRE",3]]`, JSearch capped at 2 → `"Searched 3 job types on Adzuna and FreeHire, and 2 on JSearch (its limit of 2 a day)."`
    - one search: `[["FREEHIRE",1]]` → `"Searched 1 job type on FreeHire."`
    - JSearch fully capped (0 requests) → `"Searched 3 job types on Adzuna and FreeHire. JSearch's limit of 2 a day is used up until later."`
    - a provider skipped for its key: problem `"JSearch was skipped: <sourceProblem message>"`.
    - a provider that failed: problem `"JSearch didn't answer: <JobSearchError message>"`.
    The tail is today's waiting / none-reached / drafts sentence, unchanged.
- Run flow: exactly the spec's "Data flow: one agent run" steps 1–8. Postings found by several (search, provider)
  requests are de-duplicated across the whole run with `newPostings`, keeping the first in request order (which
  is search list order). A posting is created with the search of the request that found it first.
  If every request failed, the run ends with the first failure's message (as today). If the plan is empty
  because of caps, the run records itself and ends with the searched sentence for what's possible
  (e.g. the "used up" sentence) and `"Nothing to search until then."`.

- [ ] **Step 1: Write the failing tests**

`run-message.test.ts`: the six outputs above.
`run.db.test.ts` (fake `searchPostings` keyed by source; fake config with `sourcesOn`):
  - three searches × JSearch/Adzuna/FreeHire, default caps → 8 `searchPostings` calls; the recorded run's
    `requests` has 8 entries; candidates carry `searchId`/`searchName`; the message starts with the mixed sentence.
  - JSearch key missing (`sourceProblem` returns the message) → no JSearch call; message contains
    `"JSearch was skipped:"`; the run's `requests` has no JSearch entry (Review Focus 2).
  - Adzuna throws `JobSearchError` → the others' postings are scored; message contains `"Adzuna didn't answer:"`.
  - every provider throws → the run's message is the first error's message.
  - Run now (`manual: true`) 2 h after a run that used JSearch twice → no JSearch call; message contains
    `"JSearch's limit of 2 a day is used up until later."` (Review Focus 3).
  - the same posting from two searches → one candidate, tagged with the first search.
  - `agentMaxScores: 3` with three searches each finding 2 new postings → 3 scored, one per search.
  - each setup message above, in order.
Keep the existing tests that still apply (dedupe against saved/dismissed, auto-draft, limits, P2002 race);
rewrite their setup to a single saved search on JSearch.

- [ ] **Step 2: Run them to see them fail** — `docker/bin/yarn vitest run src/lib/agent` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the agent tests, then all unit and DB tests** — `docker/bin/yarn vitest run src/lib/agent "src/app/(app)/agent"`, then `docker/bin/yarn test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Run every saved search on every provider within the daily caps"` (with `FORK.md`).

---

### Task 9: Settings → Job agent with saved searches and caps

**Files:**
- Create: `src/app/(app)/agent/search-actions.ts`, `src/app/(app)/agent/search-actions.db.test.ts`
- Create: `src/app/(app)/settings/saved-searches.tsx`, `src/app/(app)/settings/saved-searches.test.tsx`
- Create: `src/app/(app)/settings/source-caps.tsx`, `src/app/(app)/settings/source-caps.test.tsx`
- Modify: `src/app/(app)/settings/agent-section.tsx` (replace the "What it looks for" card; intro and footer copy; turn-on check)
- Modify: `src/app/(app)/settings/page.tsx` (pass searches, caps, `sourcesOn`, `agentRuns`)
- Modify: `src/app/(app)/agent/actions.ts` (`saveAgentSettings` drops `query`; `enabled: true` needs a runnable search)
- Test: `src/app/(app)/settings/agent-section.test.tsx`, `src/app/(app)/agent/actions.db.test.ts`, `e2e/agent.spec.ts`

**Interfaces:**
- Consumes: Task 5 (schema, `searchesOf`, `searchReady`, `newSearchId`, `capOf`, `SOURCE_CAPS`), Task 6 `planRequests`,
  Task 1 `agentSources` (the page computes the list and passes it).
- Produces (`search-actions.ts`, `"use server"`, all via `action()`, all `revalidatePath("/agent")`):
  - `addAgentSearch({})` → `AgentSearch` (`name: "New search"`, `enabled: false`, `EMPTY_QUERY` fields);
    at 5 → `ActionError("You can keep up to 5 saved searches. Remove one first.")`.
  - `updateAgentSearch({ id, changes: agentSearchSchema.omit({ id: true }).partial() })` → `AgentSearch`;
    enabling one that isn't ready → `ActionError("Add what to look for and a country before turning this search on.")`;
    unknown id → `ActionError("That search was removed.")`.
  - `removeAgentSearch({ id })` → `null`, toast `"Search removed. Postings it found stay on the Agent screen."`.
  - `saveSourceCap({ source: z.enum(["JSEARCH", "ADZUNA", "FREEHIRE"]), cap: z.union([z.literal([0,1,2,3,4,5]), z.literal("all")]) })` → `null`.
  Each write materialises `searchesOf(settings)` into `agentSearches` first (so the legacy search keeps id `"legacy"`).
  `saveAgentSettings({ enabled: true })` with no runnable search → `ActionError("Add a saved search and turn it on before turning the agent on.")`.
- UI (as in the mockup's "Settings → Job agent" board):
  - `SavedSearches`: list in order; one search open for editing at a time (the newly added one opens);
    fields reuse `SearchFields` and `RemoteOnlyField` (pass `source={null}` so no provider-specific hint
    appears), plus a Name input; autosave with `useAutosave` like today's query; a switch per search labelled
    `Run <name>`; "Remove" with the existing `ConfirmDialog`; "Add a search" disabled at 5 with the counter
    `3 of 5`; card intro `One per job type. Each runs on <provider names joined with "and">. Postings you saved, dismissed or applied for are left out.`
  - `SourceCaps`: a `Select` per agent source labelled `At most` with options `Not used by the agent`,
    `1 a day` … `5 a day`, `Every search`; hint per row `About <n × 30> a month` for 1–5, plus ` of your 200` for
    JSearch; `About 250 a day on a free key.` for Adzuna on "Every search"; `No quota.` for FreeHire. Below,
    the next-run preview from `planRequests` with `now = new Date()`: `Next run: <names> on all <n>.` when
    nothing is capped, else `Next run: <names> on Adzuna and FreeHire, and <names> on JSearch.`; paused searches
    add ` <name> is paused.`
  - Query help: next to the "What to look for" field in each saved search, an info button (`aria-label="About searching"`)
    opening a tooltip/popover with this exact text: `Use plain words, like a job title or a key skill, e.g. database administrator. One kind of job per search; add another saved search for alternatives like software developer.`
    No claim about OR or other operators: providers treat the text differently and none is verified. Test: the button is present and its text is shown on activation (keyboard reachable).
  - Intro copy (exact): `Once a day it runs each of your saved searches on every provider that's on, scores the new postings against your profile, and keeps the best on the Agent screen. It never sends or applies.`
  - Footer copy: replace `One search a day, and at most three in any 24 hours.` with
    `One run a day, and at most three in any 24 hours.`; the rest unchanged except "the job source only gets
    the search" → "job providers only get the searches".
  - Warning note when no agent source is on: `The agent searches the providers you turn on in Settings → Job search, and none is on yet.` (link as today).

- [ ] **Step 1: Write the failing tests** — the actions' messages and limits above (DB tests); `saved-searches.test.tsx`
  (add opens the new one, rename autosaves, pause calls `updateAgentSearch` with `enabled: false`, remove asks to
  confirm, the 5 limit disables "Add a search"); `source-caps.test.tsx` (options, hints, the two preview sentences);
  `agent-section.test.tsx` (intro, footer, turn-on refusal).
- [ ] **Step 2: Run them to see them fail** — `docker/bin/yarn vitest run "src/app/(app)/agent" "src/app/(app)/settings/saved-searches.test.tsx" "src/app/(app)/settings/source-caps.test.tsx" "src/app/(app)/settings/agent-section.test.tsx"` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Update `e2e/agent.spec.ts`**: before turning the agent on, add a saved search (name
  `Product designer`, keywords, country) through the new UI; the rest of the flow stays.
- [ ] **Step 5: Run the tests, typecheck, lint** → PASS, clean.
- [ ] **Step 6: Commit** — `git commit -m "Edit saved searches and provider caps in Settings → Job agent"` (with `FORK.md`).

---

### Task 10: The Agent screen shows and filters by search

**Files:**
- Modify: `src/lib/agent/view.ts` (`AgentCandidateView.search`, `AgentView.searchSummary`, `AgentView.filters`; drop `AgentView.search`)
- Modify: `src/app/(app)/agent/agent-screen.tsx` (tag, filter buttons, summary)
- Test: `src/lib/agent/view.db.test.ts`, `src/app/(app)/agent/agent-screen.test.tsx`

**Interfaces:**
- Consumes: Task 5 `searchesOf`; Task 7 candidate fields; Task 1 `agentSources`.
- Produces:
  - `AgentCandidateView.search: { id: string; name: string } | null` — the current name of the saved search
    when it still exists, else the stored `searchName`; `null` for candidates without `searchId`.
  - `AgentView.searchSummary: string | null` — e.g. `"3 saved searches on JSearch, Adzuna and FreeHire"`,
    `"1 saved search on FreeHire"`; null when there's no runnable search.
  - `AgentView.filters: { id: string; name: string; count: number }[]` — one per distinct `search.id` among the
    waiting candidates (scored and below minimum), in saved-search order, removed searches last by name;
    empty when fewer than two.
- UI: filter buttons (`aria-pressed`) in a group labelled `Show postings from`: `All searches · <n>` then
  `<name> · <count>`; client state only, not remembered; the tag is a small chip next to the title, as in the
  mockup's "Agent screen" board.

- [ ] **Step 1: Write the failing tests** — `view.db.test.ts`: tag from the current name after a rename; tag
  from `searchName` after the search is removed (Review Focus 5); `filters` empty with one search; the summary
  strings above. `agent-screen.test.tsx`: chips render; picking a filter hides other searches' cards and
  `aria-pressed` follows; "All searches" brings them back.
- [ ] **Step 2: Run them to see them fail** — `docker/bin/yarn vitest run src/lib/agent/view.db.test.ts "src/app/(app)/agent/agent-screen.test.tsx"` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Tag agent postings with their search and filter by it"` (with `FORK.md`).

---

### Task 11: Whole-branch check and docs

**Files:**
- Modify: `DEVELOPMENT.md` (the job agent section: several searches, caps, `agentRuns.requests`, `jobSourceUsage` as an install setting), `README.md` only where it says the agent runs one search or Dossier searches one source
- Modify: `FORK.md` (complete the table), `.project/plans/roadmap.md` (step 2 row: link this plan)

- [ ] **Step 1: Find stale wording** — `grep -rn "one search\|the source in Settings\|Pick one source\|chosen source" src README.md DEVELOPMENT.md --include=*.ts --include=*.tsx --include=*.md`; fix copy that's now wrong (tests that pin it change with it).
- [ ] **Step 2: Typecheck, lint, all tests with coverage**
  Run: `docker/bin/yarn typecheck && docker/bin/yarn lint && docker/bin/yarn test:coverage`
  Expected: clean; coverage at or above 86 % overall and 94 % `src/lib`.
- [ ] **Step 3: End-to-end**
  Run: `docker/bin/yarn build && docker/bin/yarn test:e2e`
  Expected: PASS, including `accessibility.spec.ts` on `/settings?section=jobs`, `/settings?section=agent` and `/agent`.
- [ ] **Step 4: Commit and push** — `git commit -am "Bring the docs in line with several providers and saved searches"`, `git push -u origin claude/project-thread-ug5ge7`. No PR.

---

## Manual follow-up (PJ, not agents)

1. Pull the branch, `docker compose up`, let the migration run.
2. Settings → Job search: turn on JSearch (your key), Adzuna (app ID and key) and FreeHire; test each.
3. Settings → Job agent: check your old search came over as the first saved search; add "Information
   Technology Specialist" and "Database Admin"; leave JSearch at 2 a day.
4. Agent screen → Run now; check the message names what ran and the tags and filters on the cards. Run now
   again an hour later and check JSearch is skipped with the "used up" sentence.
5. Tell Claude when it's ready for a PR.

## Cloud container toolchain

The cloud container has Node 22 and no Docker. To run the same commands as `docker/bin/yarn` there:

```bash
# Node 24 (checksum-verified) and Yarn 4.18.1 from npm, once per container
cd /tmp/claude-0 && curl -sSfLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt \
  && f=$(grep -o 'node-v24[^ ]*-linux-x64.tar.xz' SHASUMS256.txt) && curl -sSfLO "https://nodejs.org/dist/latest-v24.x/$f" \
  && grep "$f" SHASUMS256.txt | sha256sum -c && tar xJf "$f"
mkdir -p /tmp/claude-0/yb && cd /tmp/claude-0/yb && npm pack @yarnpkg/cli-dist@4.18.1 && tar xzf yarnpkg-cli-dist-4.18.1.tgz
# Postgres 16 for *.db.test.ts
pg_ctlcluster 16 main start && su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
```

`/tmp/claude-0/bin/dyarn` puts that Node first on `PATH`, sets `YARN_IGNORE_PATH=1` and
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dossier`, and runs the Yarn above. The full suite
passed with it on this branch before Task 1 (208 files, 1,734 tests).
