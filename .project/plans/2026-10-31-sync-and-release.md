# Plan: upstream sync script and `-pjd` release workflow (roadmap step 5)

Status: draft for PJ's review. No code written yet.

## Goal

1. One command to bring an upstream release into the fork, following the steps already in `FORK.md`.
2. Pushing a tag like `v1.11.0-pjd.1` builds and publishes the fork's image and a GitHub release whose notes say which upstream release it carries.

## Version format

`<upstream version>-pjd.<n>`, for example `v1.11.0-pjd.1`. The upstream part says what it includes; `n` counts the fork's own releases on top of that upstream version and restarts at 1 after each sync. This is valid semver (a pre-release suffix), so tools sort it correctly.

Open question for PJ: the first release. The fork is on upstream 1.10.0 now, so either cut `v1.10.0-pjd.1` from today's main, or sync 1.11.0 first and cut `v1.11.0-pjd.1`. Recommended: sync first, so the first release isn't already out of date.

## Facts about the repo

- `package.json` version is `1.10.0` (upstream's). Upstream bumps it in each release commit. The fork leaves it alone, so syncs don't conflict; the fork version lives only in the git tag.
- `.github/workflows/ci.yml` already builds and pushes `ghcr.io/pjd-hermes/dossier:<sha>` on every push to main after checks pass.
- `.github/workflows/release.yml` waits for that image and tags it with the version, but is gated by `if: github.repository == 'AienTech/dossier'`, so it never runs on the fork. It also fires on any `v*` tag, so it would see our tags (and skip).
- Rule 1 in `FORK.md`: new logic in new files, so don't edit `release.yml`.

## Tasks

### Task 1: `scripts/fork/sync-upstream.sh`

Automates the `FORK.md` steps. It takes the upstream tag as its argument (default: the newest `v*` tag from upstream).

- Adds the `upstream` remote (`https://github.com/AienTech/dossier`) if missing; sets `rerere.enabled`.
- Refuses to run with a dirty tree or off `main`.
- `git fetch upstream --tags`, then `git switch -c sync/<tag>` and `git merge <tag>`, never rebase.
- On conflict, stops and prints the conflicted files plus the `FORK.md` table rows that cover them.
- On success, runs `docker/bin/yarn typecheck`, `lint` and `test` (skippable with a flag), then prints the next steps: push the branch, open the PR, add a FORK.md line for any new upstream file touched.
- Never pushes by itself.

Test: a bats-style or shell test against a throwaway local repo with a fake `upstream` remote (clean merge, conflict, dirty tree, unknown tag).

### Task 2: `.github/workflows/release-fork.yml`

New file, trigger `push: tags: ["v*-pjd.*"]`, gated by `github.repository == 'pjd-hermes/dossier'`.

- Same "wait for the commit's image" step as upstream (CI builds `:<sha>` on main).
- Tag the image `ghcr.io/pjd-hermes/dossier:<tag>` and `:latest-pjd`. It must not move `:latest`, which stays unused.
- Check that the tag's commit is on `main` (`git merge-base --is-ancestor`); fail otherwise.
- Parse the upstream version from the tag, confirm the upstream tag `v<upstream>` is an ancestor of the commit (so the release really contains it), and fail if not.
- Create the GitHub release with generated notes (Task 3).

### Task 3: release notes

`scripts/fork/release-notes.sh <tag>` builds the notes:

- Header line: "Dossier <upstream> + fork changes (pjd.<n>)".
- "Includes upstream" section: link to upstream's release for `v<upstream>`.
- "Fork changes since the previous -pjd tag": `git log --first-parent` subjects between the previous `-pjd` tag (or the upstream tag, for `.1`).
- Upgrade line with the image reference.

The release workflow calls it, so the notes can be checked locally before tagging.

### Task 4: docs

- `FORK.md`: add "Releasing" (version format, how to cut a tag, `n` resets after a sync) and "Sync script" sections; the new files are all new, so the "Upstream files we change" table needs no rows.
- `DEVELOPMENT.md` is upstream's, so leave it.
- Roadmap: link this plan from step 5, move to `done/` when finished.

## Manual follow-up (needs PJ)

- Run the first sync (`scripts/fork/sync-upstream.sh v1.11.0`), review the PR, merge.
- Make sure the ghcr package is readable by PJ's VM and that Actions has "Read and write" workflow permissions on the fork.
- Push the first tag and confirm the image and release appear.

## Merge-tax check

No Prisma, `action()`, `route()` or `src/lib` changes, so the coverage gates and `session-audit.test.ts` are unaffected. The workflow and scripts get their own tests as above.
