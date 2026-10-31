# Plan: upstream sync script and `-pjd` release workflow (roadmap step 5)

Status: draft for PJ's review. No code written yet.

## Goal

1. One command to bring an upstream release into the fork, following the steps already in `FORK.md`.
2. Release notes that say which upstream release a fork release carries.

The tag format and the release workflow come from PR #4 (agreed earlier), not from this plan.

## Version format (from PR #4)

`v<upstream version>-pjd.<fork semver>`, for example `v1.10.0-pjd.0.1.0`. `-` is used because Docker tags can't hold `+`. `package.json` stays at the upstream version; the fork version lives only in the tag. `release.yml` gets the fork added to its `if:` (PR #4), so no separate fork workflow is needed.

## Facts about the repo

- `.github/workflows/ci.yml` builds and pushes `ghcr.io/pjd-hermes/dossier:<sha>` on every push to main after checks pass.
- `release.yml` waits for that image, tags it with the version and `latest`, and creates the release from the annotated tag's message. PR #4 lets it run on the fork.

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

### Task 2: release notes

`scripts/fork/release-notes.sh <tag>` builds the notes:

- Header line: "Dossier <upstream> + fork changes (<fork version>)".
- "Includes upstream" section: link to upstream's release for `v<upstream>`.
- "Fork changes since the previous -pjd tag": `git log --first-parent` subjects between the previous `-pjd` tag (or the upstream tag, for the first one on an upstream version).
- Upgrade line with the image reference.

Use it to write the annotated tag's message (`git tag -a <tag> -F <(scripts/fork/release-notes.sh <tag>)`), since `release.yml` uses that message as the release notes. It also fails if the upstream tag named in the version isn't an ancestor of the commit, so a release can't claim an upstream release it doesn't contain.

### Task 3: docs

- `FORK.md`: add "Releasing" (extends PR #4's Releases section with the sync script and the notes script; the fork semver carries on across syncs) and "Sync script" sections; the new files are all new, so the "Upstream files we change" table needs no rows.
- `DEVELOPMENT.md` is upstream's, so leave it.
- Roadmap: link this plan from step 5, move to `done/` when finished.

## Manual follow-up (needs PJ)

- Run the first sync (`scripts/fork/sync-upstream.sh v1.11.0`), review the PR, merge.
- Make sure the ghcr package is readable by PJ's VM and that Actions has "Read and write" workflow permissions on the fork.
- Push the next tag and confirm the image and release appear (PR #4 covers the first one).

## Merge-tax check

No Prisma, `action()`, `route()` or `src/lib` changes, so the coverage gates and `session-audit.test.ts` are unaffected. The workflow and scripts get their own tests as above.
