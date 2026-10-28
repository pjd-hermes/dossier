# Patch Next.js and sharp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift `next` to 16.4.1 and `sharp` to ≥ 0.35.5 so the published Next.js advisories (two critical
unauthenticated RCEs and a Server Actions DoS) are closed, pin that floor with a test, and make
`SECURITY.md`'s advisory table true again. First, stop the two upstream-only workflows (website
publishing and releases) from ever running on this fork.

**Architecture:** A dependency bump in `package.json` and `yarn.lock`, with `sharp` held by a root
`resolutions` pin. A new unit test reads the installed versions and fails if either falls below the
floor, so a later lockfile change can't quietly reintroduce them. No application code changes are
expected; if the bump forces any, they are the smallest fix and are named in the commit.

**Tech Stack:** Yarn 4 (Berry), Next.js 16 App Router, Vitest 5, Docker Compose for the toolchain (`docker/bin/yarn`).

**Spec:** [roadmap.md](roadmap.md), step 1, and §2.1 and §5 P0 of PJ's handoff of 2026-10-27 (kept outside
the repo). The relevant decisions are copied into Global Constraints below.

## Global Constraints

- `next` = `16.4.1` exactly (the repo pins exact versions for `next`). `eslint-config-next` = `16.4.1` to match.
- `sharp` ≥ `0.35.5`, pinned in root `resolutions` as `"sharp": "0.35.5"` next to the existing `mysql2` pin.
- No other dependency changes. If `yarn install` moves other packages, only the ones `next` 16.4.1 requires may move.
- Feature branch only, never `main`. Don't merge, don't build or push images. PJ merges.
- Run every yarn command through `docker/bin/yarn` (Node 24 image, Postgres for `*.db.test.ts`). If Docker isn't
  available, say so and report which commands were not run; `ci.yml` runs them all on the PR. Never claim a
  run that didn't happen.
- Coverage gates in `vitest.config.mts` are hard: 86 % lines overall, 94 % lines for `src/lib/**`. Don't lower them.
- Don't touch `ci.yml`, including its `image` job. Docker builds get reworked later.
- Don't change `proxy.ts`, `csp.ts`, `session.ts` or any auth code in this plan.

## Review Focus

1. **Signed-out Server Action calls.** `src/proxy.ts:33` passes any request with a `next-action` header through
   before the session check, and `action()` then returns its own friendly error. A Next minor bump can change
   how Server Actions are dispatched. Expected: `src/proxy.test.ts` (the `next-action` case at line 119) and
   `src/lib/action.test.ts` still pass unchanged. Covered by Task 2, Step 5.
2. **Generated route types.** `yarn typecheck` runs `next typegen` first. 16.4 may emit different route types.
   Expected: typecheck is clean with no `@ts-expect-error` or `any` added. Covered by Task 2, Step 5.
3. **ESLint rules from `eslint-config-next` 16.4.1.** New rules may flag existing code. Expected: fix the code,
   don't disable the rule. Covered by Task 2, Step 5.
4. **Two copies of sharp in the lockfile.** If anything still resolves `sharp@0.35.4`, the pin hasn't taken.
   Expected: exactly one `sharp@npm:` entry, at 0.35.5 or later. Covered by Task 2, Steps 1 and 4.
5. **Production image.** The `build` stage of the `Dockerfile` must still produce the standalone output with the
   linux-x64 sharp binary. Not run by agents (no image builds). PJ covers it in the manual follow-up, section B.

---

### Task 1: Keep the upstream-only workflows from running on this fork

`pages.yml` publishes the upstream project's website and `release.yml` creates releases and tags images
`latest`. Neither has a purpose on PJ's fork. Guard each job on the repository name rather than deleting the
files, so pulling upstream changes into those files doesn't hit modify/delete conflicts.

**Files:**
- Modify: `.github/workflows/pages.yml` (job `deploy`, line 32)
- Modify: `.github/workflows/release.yml` (job `release`, line 20)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks use.

- [ ] **Step 1: Check the current state**

Run: `grep -n "github.repository ==" .github/workflows/pages.yml .github/workflows/release.yml`
Expected: no output (no guard yet).

- [ ] **Step 2: Add the guard**

In each file, directly under the job's `name:` line, add:

```yaml
    # Upstream only: this fork doesn't publish the website or cut releases.
    if: github.repository == 'AienTech/dossier'
```

Leave the `on:` triggers alone. A job-level `if` also covers manual `workflow_dispatch` runs.

- [ ] **Step 3: Verify**

Run: `python3 -c "import yaml,sys; [print(f, yaml.safe_load(open(f))['jobs'][j]['if']) for f,j in [('.github/workflows/pages.yml','deploy'),('.github/workflows/release.yml','release')]]"`
Expected: both lines print `github.repository == 'AienTech/dossier'`.
Run: `git diff --stat`
Expected: only the two workflow files, 2 lines added in each.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml .github/workflows/release.yml
git commit -m "Keep the Pages and Release workflows from running on this fork"
```

---

### Task 2: Raise the floor for next and sharp, with a test that pins it

**Files:**
- Create: `src/dependency-floor.test.ts`
- Modify: `package.json` (`dependencies.next`, `devDependencies.eslint-config-next`, `resolutions`)
- Modify: `yarn.lock` (regenerated by yarn, never hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: the installed versions `next@16.4.1` and `sharp@>=0.35.5`, which Task 3 records in `SECURITY.md`.

- [ ] **Step 1: Write the failing test**

`src/dependency-floor.test.ts`, in the "node" Vitest project (it matches `src/**/*.test.ts`). A comment at
the top says why: the advisories that set each floor, by GHSA id
(`GHSA-2464-fhr4-w9xw`, `GHSA-673q-mjm6-r5xr`, `GHSA-p3m5-59mp-jv5r` for next; CVE-2026-96889 for sharp).
Read each installed version from `<pkg>/package.json` via `createRequire(import.meta.url)`, and compare it
with a small local `atLeast(version: string, floor: string): boolean` over the numeric `major.minor.patch`.
Don't add a semver dependency.

```ts
describe("dependency floors", () => {
  it("next is at least 16.4.1", () => {
    expect(atLeast(installed("next"), "16.4.1")).toBe(true);
  });
  it("sharp is at least 0.35.5", () => {
    expect(atLeast(installed("sharp"), "0.35.5")).toBe(true);
  });
  it("atLeast compares numerically", () => {
    expect(atLeast("16.10.0", "16.4.1")).toBe(true);
    expect(atLeast("16.3.6", "16.4.1")).toBe(false);
    expect(atLeast("0.35.5", "0.35.5")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker/bin/yarn vitest run src/dependency-floor.test.ts`
Expected: the `next` and `sharp` cases FAIL (installed 16.3.6 and 0.35.4); the `atLeast` case passes.

- [ ] **Step 3: Bump the versions**

In `package.json`, set `"next": "16.4.1"` and `"eslint-config-next": "16.4.1"`, and add `"sharp": "0.35.5"`
to `resolutions`. Then run `docker/bin/yarn install`.

- [ ] **Step 4: Check the lockfile**

Run: `grep -n -A1 '^"next@\|^"sharp@\|^"eslint-config-next@' yarn.lock`
Expected: one entry each, `version: 16.4.1`, `version: 0.35.5` (or a later 0.35.x), `version: 16.4.1`.
Run: `git diff --stat yarn.lock` and confirm that only next's own dependency tree, `@next/*`, `@img/sharp-*` and
`eslint-config-next` moved.

- [ ] **Step 5: Run the full checks**

Run, in order, and paste the summary lines of each into the task report:
- `docker/bin/yarn vitest run src/dependency-floor.test.ts`: all 3 PASS
- `docker/bin/yarn typecheck`: exit 0
- `docker/bin/yarn lint`: exit 0
- `docker/bin/yarn test:coverage`: all projects pass, no threshold error, `src/proxy.test.ts` and
  `src/lib/action.test.ts` included in the run
- `docker/bin/yarn test:e2e`: 137 passed (the count on CI at v1.9.2). If Chromium or the e2e database can't
  start in this environment, report it as not run.

If a check fails because of the bump, make the smallest code fix, rerun everything in this step, and name
the fix in the commit body.

- [ ] **Step 6: Commit**

```bash
git add package.json yarn.lock src/dependency-floor.test.ts
git commit -m "Update next to 16.4.1 and pin sharp to 0.35.5

Closes GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r
(next) and CVE-2026-96889 (sharp). A test now pins both floors."
```

---

### Task 3: Make the advisory table in SECURITY.md true again

**Files:**
- Modify: `SECURITY.md` (section "## Dependencies", lines 39-48 at v1.9.2)

**Interfaces:**
- Consumes: the lockfile from Task 2.
- Produces: nothing code depends on.

- [ ] **Step 1: Collect the current advisories**

Run: `docker/bin/yarn npm audit --all --recursive`
Expected: no advisory for `next` or `sharp`. Keep the human-readable output for the report.

- [ ] **Step 2: Rewrite the table**

Change the date in "checked on 28 September 2026" to the date of the run. For each remaining advisory, add
or keep a row: package and version, where it comes from, the advisory link, and why it's accepted. Use the
style and tone of the existing rows. Remove the `deepmerge-ts` and `eslint` rows only if the audit no longer
reports them. Keep the `mysql2` paragraph. If an advisory is reachable at runtime and has a fix, don't
accept it in the table: list it in the task report as a follow-up for PJ instead.

- [ ] **Step 3: Verify**

Every row in the table matches an advisory in the Step 1 output, and every advisory in that output has a
row or a follow-up entry. State the counts in the report (for example "audit: 7, table: 6, follow-up: 1").

- [ ] **Step 4: Commit**

```bash
git add SECURITY.md
git commit -m "Refresh the dependency advisory table in SECURITY.md"
```

---

## Manual follow-up (PJ, not agents)

**A. Enable Actions on the fork.** GitHub turns Actions off on forks. Enable them in the repo's Actions tab
before the PR is opened, so `ci.yml` runs the checks this plan relies on.

These steps finish roadmap step 1. They need PJ's VM, accounts and judgement, so they aren't agent tasks.

**B. Build and deploy on the VM.** `compose.production.yml` defaults to `ghcr.io/aientech/dossier:latest`,
which doesn't contain this patch.
1. On the VM: check out the merged branch and run `docker build -t dossier:1.9.2-p1 .`
2. In a folder of its own, save `compose.production.yml` as `compose.yml`, and write a `.env` with
   `POSTGRES_PASSWORD`, `DOSSIER_PASSWORD` (from `docker run --rm -it dossier:1.9.2-p1 hash-password`),
   `DOSSIER_SECRET` (`openssl rand -base64 32`), `DOSSIER_IMAGE=dossier:1.9.2-p1`, `TZ` and `DOSSIER_PUBLIC_URL`.
3. Run `docker compose up -d` and watch `docker compose logs -f app` until migrations and the theme seed finish.
4. Put a reverse proxy with TLS (Caddy) in front of `127.0.0.1:3000`. Never expose 3000 directly.
5. Under Settings → AI provider → OpenAI-compatible, enter `https://openrouter.ai/api/v1` (no `/models`) and
   `deepseek/deepseek-chat`. Set a credit limit on the key.
6. Smoke test: sign in, import a resume, create an application from a pasted posting, and download the PDF.

**C. JSearch check (10 minutes).** Search Find jobs for the exact title and city of a live NEOGOV posting.
Record the result in `roadmap.md`. A miss rules JSearch out for government jobs.

**D. Alerts mailbox.** Create a dedicated mailbox and sign up with it directly (not forwarded) for NEOGOV
Job Interest Cards and any LinkedIn or Indeed alerts for your job types. Note the provider in
`roadmap.md` for step 4.
