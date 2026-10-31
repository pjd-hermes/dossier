# Design and plan: duplicate and ghost-job detection (roadmap step 7)

Status: decisions taken, ready to build. No code written yet.
Decided by PJ on 2026-10-31: the agent skips postings older than 60 days (setting, 0 turns it off). The other recommendations below stand unless PJ changes them. Base: fork main with Dossier 1.11.0.

## What exists, and the gap

The job agent already de-duplicates, in `src/lib/agent/candidates.ts` (`agentDedupeKey`) and `newPostings` in
`src/lib/agent/run.ts`. The key is a hash of the **link** without tracking parameters, and only if there is no link, of
company + title + place. So:

| Case | Caught today? |
|---|---|
| Same posting found twice by the same provider | Yes (source + id, and the key). |
| Same job on JSearch and Adzuna | **No.** Both have a link, the links differ, so the keys differ. Since step 2 (several providers at once) this is the common case. |
| Same job reposted weeks later with a new id and link | **No.** Nothing records that it was seen before. |
| Dismissed or saved on one provider, shown on another in Find jobs | **No.** `postingStates` (`src/lib/postings.ts`) matches saved and dismissed postings by `(source, externalId)` only. It does match an application by link, so "applied" is caught when both providers give the same link. |
| Job open for months | Not flagged; `postedAt` is stored but unused. |

## Goal

One job appears once, however many providers and reposts carry it, and a job that looks stale or endlessly reposted says so.

### Success criteria

- With JSearch and Adzuna on, a job both return reaches the Agent screen once.
- A job dismissed, saved or applied for through one provider shows that mark in Find jobs on every provider.
- A repost under a new id within the sighting window is recognised, not re-scored, and the earlier candidate shows "Seen again".
- Postings older than the PJ-set age are skipped by the agent and badged in Find jobs. The default is 60 days; 0 turns it off.
- No migration; nothing here changes an export except one install-only setting that stays out of it.
- Coverage gates (86 % overall, 94 % `src/lib`), `session-audit.test.ts` still pass.

## Design

### One definition of "the same job"

New `src/lib/job-identity/` (new files only):

- `fingerprint(posting)`: normalised company + title + city, built from the same `normal` function the agent uses, plus:
  - company: drop legal suffixes (GmbH, Inc, LLC, Ltd, AG, BV, SA, Corp, Co) and a leading "The".
  - title: drop level and gender noise in brackets ("(m/f/d)", "(all genders)", "- Remote"), lower-case, collapse "Sr", "Sr.", "Senior".
  - place: the first word group before a comma, so "Berlin, Germany" and "Berlin" match; remote postings use the token `remote`.
- `sameJob(a, b)`: true when the link keys match, or the fingerprints match.
- A posting with no company and no title never fingerprints (the existing fallback to source id stays).

The agent's `agentDedupeKey` stays, so stored `dedupeKey` values keep working; `newPostings` gains a second check by fingerprint (see Matching).

### Matching without a migration

`AgentCandidate`, `Posting` and `Application` rows are few (hundreds), so matching reads the rows from the last
`DUPLICATE_WINDOW_DAYS` (default 180) with `select` of the identity fields only and computes fingerprints in memory.
Indexed storage is a later optimisation if it ever matters; the fork's rule is settings and computation before Prisma.

- `findKnown(postings)` returns, per posting, the strongest prior mark: `applied` (an `Application` from a posting or candidate), `saved`, `dismissed`, `candidate`, in that priority, with the provider it came from.
- `newPostings` (agent) drops anything with a known mark. Today it only checks the same source; now it checks the fingerprint across sources.
- Find jobs (`jobs/actions.ts` and `jobs-screen.tsx`) shows a chip on a result with a mark from another provider: "Dismissed on Adzuna", "You applied for this (via JSearch)". A dismissed one is greyed with **Show anyway**.

### Sightings (reposts and ghost signals)

New install-only setting `jobSightings` (JSON, stays out of exports like `jobSourceUsage`):

```ts
Record<fingerprint, { first: "YYYY-MM-DD"; last: "YYYY-MM-DD"; ids: number; sources: JobSource[] }>
```

- Updated for every posting a search returns (Find jobs and the agent), after matching. `ids` counts distinct `source:externalId` pairs seen; pruned of entries not seen for 180 days and capped at 3000 entries (oldest `last` first).
- Signals computed from it and from `postedAt`:

| Signal | Rule | Shown as |
|---|---|---|
| Old | `postedAt` older than the age limit (default 60 days) | "Posted 74 days ago" |
| Reposted | `ids >= 2` with `last - first >= 14` days | "Seen 3 times since 2 Oct" |
| Everywhere | seen on 3 or more providers | no signal; only a normal duplicate |

These are hints, not verdicts: a company can legitimately keep a role open. So they badge and, for the agent, optionally skip; they never delete.

### Agent behaviour

- Setting `agentMaxPostingAgeDays` (number, default 60, 0 = off). The agent doesn't score a posting past the limit, so it spends no AI call on it. It counts them in the run message: "Skipped 4 older than 60 days."
- A reposted job whose earlier candidate was dismissed stays dismissed. One that was merely scored (still on the Agent screen) isn't added again; the candidate gains "Seen again on DATE" in its reasons list (a string appended in memory when shown, not stored).

### Screens

- Find jobs: chips for marks from other providers; age and repost badges on cards; Settings → Job search gets the age limit field.
- Agent: "Seen again" and age badges on a candidate; the run summary line.
- Settings → Job agent: the age limit, beside the caps.

### Out of scope

AI judgement of "is this a ghost job" (needs a model call per posting; revisit if the hints prove useful), merging stored duplicates retroactively, fuzzy title matching beyond the rules above.

## Decisions for PJ

| Question | Recommendation |
|---|---|
| Age limit default | 60 days, with 0 to turn it off. |
| Should an old posting be skipped or just badged by the agent? | Skipped by the agent (saves AI calls), badged in Find jobs. |
| Window for remembering a job | 180 days. |
| Match on company + title + city only, or also salary range? | Without salary: it is often missing. |

## Tasks

1. **Fingerprint and `sameJob`.** `src/lib/job-identity/fingerprint.ts` with a table-driven test of real-world pairs ("Acme GmbH"/"Acme", "Sr. Engineer (m/f/d)"/"Senior Engineer", "Berlin, Germany"/"Berlin", accents, remote). Pure; no other change.
2. **`findKnown` and the agent.** `newPostings` uses it; db tests for the cross-provider duplicate, the dismissed-elsewhere case, and the window. Existing `dedupeKey` behaviour unchanged (existing tests still pass).
3. **Find jobs marks.** Chips for marks from another provider; "Show anyway"; tests in `jobs-screen.test.tsx` and `jobs/actions.db.test.ts`.
4. **Sightings.** `jobSightings` setting and `src/lib/job-identity/sightings.ts` (record, prune, cap, signals) with unit tests; added to `INSTALL_SETTINGS` in `data-export.ts` and its test.
5. **Age and repost badges, and the agent's age limit.** `agentMaxPostingAgeDays`, the run message, Settings fields, badges in Find jobs and on the Agent screen.
6. **Docs.** README line, `DEVELOPMENT.md` section, `FORK.md` rows for each upstream file touched.

## Manual follow-up (PJ)

- Run two providers for a few days on the saved searches and check that Agent shows each job once and the "Seen again" cases are real reposts.
- Tune the age limit after seeing what it skips.

## Merge-tax check

No Prisma change, so no export, import, delete-everything or backup work beyond keeping `jobSightings` out of exports. No new `action()`s except possibly the "Show anyway" toggle, which goes through `action()` + `verifySession()`. Upstream files touched, to be listed in `FORK.md`: `src/lib/agent/run.ts`, `src/lib/settings.ts`, `src/lib/data-export.ts`, `src/lib/job-search/index.ts`, `src/app/(app)/jobs/actions.ts`, `jobs-screen.tsx`, the Agent screen, and the two settings sections.
