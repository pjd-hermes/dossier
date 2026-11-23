# Vetting source and drafting from n8n: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an n8n workflow tag a posting as direct or recruiter-posted (with a link to the direct posting), skip finds that already have an application, and draft applications for the good ones through a new `draft` token scope.

**Architecture:** Extend the existing `Posting.vetting` JSON with two optional fields (no migration), add one token scope that gets `draft_application`, expose `applicationId` on `list_agent_finds`, and guard `draft_application` against drafting a posting twice. New logic in new files; upstream files get thin calls (FORK.md rule 1).

**Tech Stack:** Next.js, Prisma (PostgreSQL + SQLite), `@modelcontextprotocol/server`, zod, vitest.

**Spec:** `/mnt/project-files/specs/n8n-posting-vetting-workflow.md` (Parts A and A2); decisions made in the project thread on 2026-11-22.

## Global Constraints
- Source values exactly `"direct"`, `"recruiter"`, `"unknown"`; verdict values stay `"legit"`, `"doubtful"`, `"scam"`. `directUrl` is an http(s) URL of at most 500 characters.
- Token scopes exactly `"read"`, `"dismiss"`, `"draft"`. `draft` = everything `dismiss` allows plus `draft_application`. `read` and `dismiss` never see `draft_application`.
- Old stored verdicts without the new fields read as `source: "unknown"` and no `directUrl`. No migration, no export format change.
- A recruiter verdict never dismisses anything. Nothing here sends or deletes.
- Every upstream file touched is listed in FORK.md; new logic in new files.
- Tests run on SQLite here (`DATABASE_URL=file:...`) and must also pass on PostgreSQL in CI; `yarn typecheck`, `lint`, `knip` stay green.

## Review Focus
1. A stored verdict from before this change (no `source`) still parses and shows as before.
2. `directUrl` with a non-http scheme, or over 500 characters, is refused as the caller's mistake, never stored.
3. A `dismiss` token calling `draft_application` gets "unknown tool"; a `draft` token cannot call `save_application`, `search_jobs` or `set_application_status`.
4. `draft_application` for a posting that already has an application returns that application and starts no job, even while the AI provider is not set up.
5. `dismiss_posting` keeps `source`/`directUrl` out of its own input: it records `unknown`, and an earlier recorded `source` is not wiped by a dismissal.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/vetting-shape.ts` (modify) | `SOURCES`, `source` and `directUrl` in the schema, `PostingVetting` carries them, `sourceBadge`, `vettingFact` words them |
| `src/lib/vetting.ts` (modify) | `recordVetting` takes `source`, `directUrl`; `dismissWithReason` keeps an earlier `source`/`directUrl` |
| `src/lib/connector/vetting-tools.ts` (modify) | `record_vetting` input `source`, `direct_url` |
| `src/app/(app)/jobs/posting-results.tsx` (modify) | the recruiter tag and a "Direct posting" fact |
| `src/lib/settings.ts`, `src/lib/connector/tokens.ts`, `src/app/(app)/settings/connector-token-actions.ts`, `connector-tokens.tsx` (modify) | the `draft` scope everywhere a scope is listed |
| `src/lib/connector/scopes.ts` (modify) | which tools `draft` may use |
| `src/lib/agent-finds.ts` (modify) | `AgentFind.applicationId` |
| `src/lib/connector/draft-guard.ts` (new) | `existingApplicationFor(postingId)` |
| `src/lib/connector/tools.ts` (modify) | one call in `draft_application` to the guard |
| `FORK.md` | upstream-files table, new files, n8n setup note |

---

### Task 1: `source` and `directUrl` on a verdict
**Files:** modify `src/lib/vetting-shape.ts`, `src/lib/vetting.ts`, `src/lib/connector/vetting-tools.ts`; tests in `src/lib/vetting.db.test.ts`, `src/lib/connector/vetting-tools.db.test.ts`, a shape test beside `vetting-shape.ts`.
**Interfaces:**
- Produces: `SOURCES = ["direct","recruiter","unknown"] as const`, `type Source`; `Vetting` gains `source: Source` and `directUrl?: string`; `recordVetting(postingId, input: { verdict; note; checks?; source?: Source; directUrl?: string }, checkedBy)`; `sourceBadge(vetting): string | null` ("Via recruiter" for recruiter, else null); `PostingVetting` also picks `source` and `directUrl`.
- [ ] Write failing tests: `vettingOf({verdict:"legit",note:"",checks:[],checkedBy:"n8n",checkedAt:"x"})` returns `source: "unknown"`; `record_vetting` with `source: "recruiter", direct_url: "https://acme.example/jobs/1"` stores both and `list_agent_finds` returns them; `direct_url: "ftp://x"` and a 501-character URL return `isError`; `dismiss_posting` after a recorded recruiter verdict keeps `source` and `directUrl`.
- [ ] Run them, expect FAIL: `yarn vitest run src/lib/vetting src/lib/connector/vetting-tools`.
- [ ] Implement as above; `dismissWithReason` merges onto the existing parsed verdict's `source`/`directUrl`.
- [ ] Run them, expect PASS. Commit `feat: vetting records a posting's source and a direct link`.

### Task 2: show it in Positions
**Files:** modify `src/app/(app)/jobs/posting-results.tsx` (badge list and facts), test in its existing test file.
**Interfaces:** Consumes `sourceBadge`, `PostingVetting` (Task 1).
- [ ] Failing test: a posting whose state has `vetting: { verdict: "legit", source: "recruiter", directUrl: "https://acme.example/jobs/1", ... }` shows the "Via recruiter" tag and a "Direct posting" fact with that link; one without `source` shows neither.
- [ ] Implement: add `sourceBadge(state.vetting)` after `vettingBadge`, and a `Direct posting` fact rendered as a link (http(s) only, `rel="noopener noreferrer"`).
- [ ] Run, expect PASS. Commit `feat: show a recruiter tag and the direct posting`.

### Task 3: the `draft` scope
**Files:** modify `src/lib/settings.ts`, `src/lib/connector/tokens.ts` (`TokenScope`), `src/lib/connector/scopes.ts`, `connector-token-actions.ts`, `connector-tokens.tsx`; tests in `scopes`/`vetting-tools.db.test.ts`, `connector-tokens.test.tsx`, `actions.db.test.ts`.
**Interfaces:** `TokenScope = "read" | "dismiss" | "draft"`; `toolAllowed`: `draft` allows read-only tools, the three dismiss tools and `draft_application`.
- [ ] Failing tests: a `draft` token's `tools/list` has `draft_application` and the three dismiss tools and lacks `save_application`, `search_jobs`, `set_application_status`; a `dismiss` token's list lacks `draft_application`; Settings offers "Read, dismiss and draft" and creating one works.
- [ ] Implement; the card text says what `draft` adds (Dossier's own AI writes drafts; nothing is sent).
- [ ] Run, expect PASS. Commit `feat: a draft scope for access tokens`.

### Task 4: `applicationId` on agent finds
**Files:** modify `src/lib/agent-finds.ts`, test `src/lib/agent-finds.db.test.ts`.
**Interfaces:** `AgentFind.applicationId: string | null` (the posting's `applicationId`).
- [ ] Failing test: a find whose posting has an application lists its id; one without lists `null`.
- [ ] Implement, add to the tool's description ("applicationId: set when an application already exists"). Run, expect PASS. Commit `feat: list_agent_finds says which finds have an application`.

### Task 5: guard `draft_application`
**Files:** create `src/lib/connector/draft-guard.ts`; modify `src/lib/connector/tools.ts` (one call at the top of the `draft_application` handler); tests `draft-guard.db.test.ts` and a case in `tools.db.test.ts` or `draft.db.test.ts`.
**Interfaces:** `existingApplicationFor(postingId: string | undefined): Promise<string | null>`.
- [ ] Failing tests: for a posting with `applicationId`, `draft_application` returns `{ status: "exists", application_id, link }`, starts no job, and does so without an AI provider; unknown or missing `posting_id` returns null and falls through to the existing behavior.
- [ ] Implement; the response shape matches what `check_draft` returns when done (`status`, `application_id`, `link`) plus `status: "exists"`.
- [ ] Run, expect PASS. Commit `feat: draft_application doesn't draft a posting twice`.

### Task 6: docs and a full check
**Files:** `FORK.md` (upstream-files rows for `tools.ts` (now three thin calls), `settings.ts`, `posting-results.tsx`, `connector-tokens.tsx`/`connector-token-actions.ts`; files-only-here row for `draft-guard.ts`; the n8n note: scopes, `source`, `draft`), `.project/roadmap.md`.
- [ ] Update docs. Run `yarn typecheck`, `yarn lint`, `yarn knip`, and the unit and DB suites on SQLite. Expect all green (PostgreSQL runs in CI).
- [ ] Commit `docs: fork notes for source, direct links and the draft scope`; push; open the PR.

## Self-review
- Spec coverage: Part A (Tasks 1, 2), A2 scope (3), `applicationId` (4), guard (5), docs (6).
- Names consistent: `SOURCES`/`Source`/`sourceBadge` (1, 2), `TokenScope` (3), `existingApplicationFor` (5).
- To check first: where the Positions component is tested (Task 2), and whether `draft_application`'s existing tests mock the AI provider (Task 5).
