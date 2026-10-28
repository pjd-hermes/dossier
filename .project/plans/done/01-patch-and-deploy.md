# Step 1: Patch and deploy, and sign up for alerts

**Status:** ready for PJ · **Branch:** a new feature branch from `v1.9.2` (e.g. `fix/next-16.4.1`)
**Done when:** PJ's own patched build runs on the VM behind TLS, using OpenRouter, and alert emails
are arriving in the dedicated mailbox.

Nothing here has been run by Claude. The repo facts below were read from source on 2026-10-28.

## A. Patch dependencies (code change, one PR)

Current state, read from the repo:

- `package.json`: `"next": "16.3.6"` and `"eslint-config-next": "16.3.6"`.
- `yarn.lock`: `sharp@npm:^0.35.4` resolves to `0.35.4` (pulled in by `next`).
- `resolutions` already holds one pin (`mysql2`); add the new one beside it.

Steps:

1. Set `next` and `eslint-config-next` to `16.4.1` in `package.json`.
2. Add `"sharp": "0.35.5"` (or the latest 0.35.x) to `resolutions`. Because the range is `^0.35.4`, a plain
   `yarn up -R sharp` would also lift it, but the explicit pin documents why and survives lockfile churn.
3. `docker/bin/yarn install` to rewrite `yarn.lock`. Confirm with
   `grep -n -A2 '^"next@\|^"sharp@' yarn.lock`.
4. Re-run the advisory check: `docker/bin/yarn npm audit --all --recursive`. Note what remains.
5. Update the table in `SECURITY.md` ("## Dependencies", currently "checked on 28 September 2026") with
   today's date and the advisories that remain, each with a reason it is accepted or a follow-up.
   Drop any accepted row that no longer applies.
6. Run and keep the real output for the PR:
   - `docker/bin/yarn typecheck`
   - `docker/bin/yarn lint`
   - `docker/bin/yarn test:coverage` (coverage gates are hard: 86 % overall, 94 % `src/lib`)
   - `docker/bin/yarn test:e2e` if you can; otherwise say it wasn't run.

`docker/bin/yarn` runs yarn inside the app container from `compose.yml`, so the host needs only Docker.

**Watch for:** Next minor bumps sometimes change generated route types (`next typegen`) or ESLint rules.
If typecheck or lint fails, fix the code rather than loosening config, and call it out in the PR.

## B. Build and deploy on the VM

`compose.production.yml` defaults to `ghcr.io/aientech/dossier:latest`. Your patched code isn't in that
image, so build it on the VM and point compose at your tag.

1. On the VM, check out the patched branch and build:
   `docker build -t dossier:1.9.2-p1 .` (amd64, which the VM is).
2. In a folder of its own, copy `compose.production.yml` as `compose.yml` and create `.env`:
   - `POSTGRES_PASSWORD` (random)
   - `DOSSIER_PASSWORD`: hash from `docker run --rm -it dossier:1.9.2-p1 hash-password`
   - `DOSSIER_SECRET`: `openssl rand -base64 32`
   - `DOSSIER_IMAGE=dossier:1.9.2-p1` (never `latest`)
   - `TZ`, and `DOSSIER_PUBLIC_URL` once the hostname is known
3. `docker compose up -d`, then `docker compose logs -f app` until migrations and the theme seed finish.
4. Reverse proxy with TLS (Caddy is the least setup) to `127.0.0.1:3000`. Never expose port 3000
   directly: the app trusts `X-Forwarded-For` and `X-Forwarded-Proto`.
5. Settings → AI provider → OpenAI-compatible: `https://openrouter.ai/api/v1` (no `/models`), model
   `deepseek/deepseek-chat`. Set a credit limit on the OpenRouter key.
6. Smoke test: sign in, import a resume, create one application from a pasted posting, download the PDF.
7. Take a backup before any later upgrade; an upgrade is a new tag plus `docker compose up -d`.

## C. JSearch check (10 minutes)

Take the exact title of a live NEOGOV posting you know exists, plus its city, and search for it in Find
jobs with JSearch. Record the result in the roadmap. If even an exact title misses, JSearch is ruled out
for government jobs and step 4 carries them.

## D. Mailbox and alerts (start now so samples collect)

1. Create a dedicated mailbox for alerts only. Sign up with it **directly** at each site; don't
   forward from another account (forwarding breaks SPF/DKIM and mangles tracking links).
2. Subscribe it to NEOGOV Job Interest Cards for your job types and agencies, plus any other boards
   that send alerts (LinkedIn, Indeed).
3. Leave it alone until step 4. Note the provider (Gmail app password, Fastmail, own domain) in the
   roadmap, since step 4 reads it over IMAP.

## PR checklist

- [ ] `next` and `eslint-config-next` at 16.4.1, `sharp` ≥ 0.35.5 in `yarn.lock`
- [ ] `SECURITY.md` table dated and accurate
- [ ] typecheck, lint, test:coverage output pasted; e2e run or stated as not run
- [ ] No other changes in the diff
