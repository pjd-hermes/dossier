# Roadmap: Dossier for PJ's job search

Agreed 2026-10-28. PJ builds each step; Claude writes the plan file and reviews the PR.
Background, audit findings and verified facts: the handoff of 2026-10-27 (not in the repo).

PJ searches by **job type**, not by employer, across both government and company postings.
JSearch did not find the government postings in PJ's own testing.

| # | Step | Why this order | Plan |
|---|---|---|---|
| 1 | Patch, bring in upstream PR #19 (OpenCode Go), deploy, and sign up for alerts | Closes the live Next.js advisories before anything is exposed; alert emails start collecting for step 4 | [2026-10-28-patch-next-sharp.md](2026-10-28-patch-next-sharp.md) |
| 2 | Several providers at once, and saved searches by job type (upstream issue #11, widened for the fork) | Main discovery tool for everything JSearch, Adzuna and FreeHire can see | Design: [2026-10-29-saved-searches-design.md](2026-10-29-saved-searches-design.md); plan: [2026-10-29-saved-searches.md](2026-10-29-saved-searches.md) |
| 3 | `import_posting` MCP tool | Shared entry point for postings that come from outside the search adapters | to write |
| 4 | Email-alert ingestion (NEOGOV Job Interest Cards first) | Covers the government postings JSearch misses; needs step 3 and the emails collected since step 1 | to write |
| 5 | Upstream sync script and `-pjd` release workflow | Makes each upstream release (now 1.11.0) a repeatable merge, with release notes that name the upstream release. The tag format and release workflow come from PR #4 | [2026-10-31-sync-and-release.md](2026-10-31-sync-and-release.md) |
| 6 | Follow-up reminders and stale-application nudges | Dashboard card for applications with no reply after N days, with an AI-drafted follow-up built on the inbox and Gmail code. Built together with step 7 | to write |
| 7 | Duplicate and ghost-job detection | Several providers on at once means the same posting repeats: merge by company and title, flag long-reposted postings | to write |

## Ideas, TBD

Not scheduled. Source: review of upstream AienTech/dossier's releases on 2026-10-31.

- **Interview prep per application:** likely questions from the posting and the profile's gaps, and a STAR-story bank from experience bullets.
- **Pipeline analytics:** response rate by source, resume theme and score band, to check whether Score predicts replies.
- **Salary and offer tracking:** range from the posting, PJ's expectation, offer comparison. Upstream has no compensation field.
- **Contacts and referrals:** who PJ knows at each company, and when they were contacted.
- **Application-form helper:** reusable answers to ATS questions such as "why us?" and work authorization.
- **AI cost view:** per-run cost of AI calls.

## Dropped or parked

- **ATS adapters (Greenhouse, Ashby, Lever):** each board is one employer, queried by company slug, so they
  don't serve a job-type search. Revisit only if a list of target employers appears. RemoteOK is
  cross-company and stays a candidate if remote roles matter.

## Standing rules

- Feature branches only. PJ merges, runs integration tests and smoke tests.
- Superseded plans move to `done/`.
- Plans are written with the superpowers writing-plans skill and run with subagent-driven development;
  steps that need PJ's VM or accounts go in a "Manual follow-up" section.
- Every PR meets the merge tax: `action()` / `route()` / `verifySession()` (enforced by
  `session-audit.test.ts`), coverage gates (86 % overall, 94 % `src/lib`), and for any Prisma change the
  export, import, delete-everything and backup paths plus their tests.
