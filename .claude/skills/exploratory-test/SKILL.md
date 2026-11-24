---
name: exploratory-test
description: Use the running Dossier app like a real user, with fake AI and job portals, to check a change (a PR or branch) and the existing features, then write a report. Use before a build or release, or when asked to test, verify or QA a change.
---

# Exploratory test

Check a change by using the app, not only by reading code. Fake AI, job-portal and Google servers stand in for the real ones, so nothing external is called and nothing real is touched. The deterministic suite (`yarn test:e2e`) covers what's already scripted; this finds what nobody wrote a test for. It is advisory: report, don't fix.

## 1. Understand the change

- The target is the PR or branch the user names; with none, the current branch against `main`. Read `git diff main...HEAD` (for a PR: `git fetch origin pull/<n>/head:pr<n>`) and the PR description.
- List what the change should do and what else it could affect (screens that show the same data, MCP connector tools, exports, emails). Check `e2e/*.spec.ts` for specs that assert the old behaviour; a spec that contradicts the change is a finding, whichever side is wrong.

## 2. Start the app

On the target's code:

```bash
yarn install --immutable && yarn generate && yarn build
yarn e2e:serve            # needs Postgres via DATABASE_URL; creates <db>_e2e
```

Wait for "Dossier is up at http://localhost:3100". Sign in with password `e2e-password`. The data is the demo profile and demo applications; the AI is `e2e/fake-ai.mts` (canned answers by task, so judge that the app handled them, not that the writing is good) and job search is `e2e/fake-jobs.mts`. Drive the app with Playwright MCP or the Claude in Chrome tools, or a short Playwright script (`playwright-core` is installed). Prefer reading page text and roles over screenshots; take screenshots for findings.

## 3. Regression sweep (always)

Each: does it load without console errors, show sensible data, and do its main action?

- Sign in and out; wrong password refused.
- Dashboard.
- Profile: edit a field, reload, it stuck. Base resume preview.
- Jobs / Find jobs: search, save, dismiss, start an application from a posting.
- New application: read a posting, write resume and letter, open the application, edit, download PDF.
- Applications board and list: status changes, filters.
- Agent: searches and finds.
- Settings: AI provider, job search, connector (turn it on, token created).
- MCP connector: with a token, POST `/api/mcp` `tools/list` and call one read tool.
- Anything else the diff's blast radius named.

## 4. Change checks

For each thing the change should do, write the steps you'll take and the result you expect before you try them, then do them. Include the unhappy and edge cases (empty state, a record in each status, a very long value, back/reload). Check that what the change should NOT touch didn't move.

## 5. Report

Write `exploratory-report.md` (repo root, untracked) with:

- **Verdict**: ship / ship with notes / don't ship, one line why.
- **Change checks**: table of check, steps, expected, actual, pass/fail.
- **Regression sweep**: table of area, pass/fail, notes.
- **Findings**: one per item with severity (broken / wrong / rough), exact steps, expected vs actual, screenshot path, and the likely file if you can tell.
- **Not checked**: what you skipped and why (real AI quality and real portals are out of scope here).

Stop the servers when done. Say which findings you're sure of and which are guesses.
