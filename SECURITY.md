# Security

Dossier is a single-user app you run on your own server. It holds your career history, your job applications and, if you use a hosted model, an AI provider's API key. This page covers what protects that data, what it expects from your setup, and how to report a problem. What Dossier keeps, for how long and who receives what is in [PRIVACY.md](PRIVACY.md).

## Reporting a vulnerability

Please report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Don't open a public issue for it.

## What Dossier does

- **Sign-in.** One password, kept only as an argon2id hash in `DOSSIER_PASSWORD`, so the environment doesn't reveal it; the server won't start with the password itself there. The session is an encrypted, HttpOnly, SameSite=Lax cookie, marked Secure over HTTPS. Failed sign-ins are rate-limited per IP and overall. See [Sign-in](DEVELOPMENT.md#sign-in).
- **Every request checks the session.** The proxy only does a quick check before a page renders, so each page, Server Action and route handler checks the session again next to the data. Server Actions go through `action()`, route handlers through `route()`, and a test (`src/lib/session-audit.test.ts`) fails when one doesn't. The only exceptions are signing in and signing out.
- **Cross-site requests.** Next.js refuses Server Actions from another origin, and `route()` does the same for route handlers.
- **Content-Security-Policy.** Every page gets a policy with a fresh nonce: scripts run only when they carry it, nothing loads from other hosts, and no other site may frame Dossier. `next.config.ts` adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` and `Permissions-Policy` to every response.
- **API keys.** Stored encrypted with a key derived from `DOSSIER_SECRET`, never sent to the browser, never logged. The AI provider's key and the job sources' keys each have their own derived key, and each job source's key only goes to that source. The AI server's address is yours to set, so when a request carries a key, Dossier doesn't follow a redirect to another host.
- **Job sources.** Find jobs is off until a source is chosen. Searches go from the server to that source's fixed address only, with a time and size limit; the browser never talks to a job source. A link in a result is kept only when it's `http(s)`, and postings sent back from the browser are checked the same way. Fetching the rest of a posting goes through the same guarded fetcher as Fetch, so it never reaches the server's own network.
- **Google.** Gmail and Calendar are off until you enter your own OAuth client and connect. Signing in is OAuth's authorization code flow with a `state` signed by a key derived from `DOSSIER_SECRET`, valid for 10 minutes, and the callback needs your session too. The refresh token and the client's secret are stored encrypted, each with its own derived key, and never sent to the browser or logged; access tokens stay in the server's memory. Dossier asks only for the permissions of the features you choose (sending, reading, free/busy and events), and every send needs your confirmation.
- **Errors.** Unexpected errors are logged on the server without the data involved; the browser only gets a generic message.

## AI and untrusted text

A job posting, or a reply from Gmail, is text someone else wrote, and it goes into prompts. It could try to steer the model ("ignore your instructions and…"). What limits the damage:

- The model has no tools: it can't read your other data, browse or change anything. It only returns text.
- What it returns is shown as plain text, never as HTML, and checked against a schema before it's saved.
- The fact guard flags claims in a draft that your profile doesn't back up.
- You read every document before you send it, and a drafted answer to a mail only goes out when you confirm it.
- Reading a mail only suggests a status for its application, which you take up or not.

So the worst a hostile posting or mail can do is get odd wording into its own draft, or suggest the wrong status.

## Running it safely

- **Use HTTPS.** Put Dossier behind a reverse proxy that ends TLS (Caddy, Traefik, nginx). Set `Strict-Transport-Security` there. Dossier adds `upgrade-insecure-requests` to its policy when the proxy says the request came over HTTPS (`X-Forwarded-Proto`).
- **Don't expose port 3000 directly.** Rate limiting trusts the last `X-Forwarded-For` entry, which is only the real client behind a proxy.
- **Pick a long `DOSSIER_SECRET`** and keep it with your backups: without it, saved API keys can't be read. Changing it or the password signs out every session.
- **Keep it updated.** Settings → About tells you when a new version is out.

## Dependencies

Dependabot proposes updates once a week, for the npm packages, GitHub Actions and Docker images. Advisories that `yarn npm audit --all --recursive` still reports, checked on 28 October 2026:

| Package | Advisory | Why it's accepted |
|---|---|---|
| `@vitest/mocker` 5.0.2, from `vitest` | Code injection through manual mock registration ([GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)); Windows path traversal past the redirect allowlist ([GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)) | Tests only. It's never part of the image, and Dossier's code doesn't import it. Goes away with the next Vitest patch release. |
| `deepmerge-ts` 7.1.5, from `@prisma/config` | Stack exhaustion on recursive objects ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)) | Only merges Prisma's own config when its CLI starts; no user input reaches it. The fix is in 8.x, which Prisma doesn't support yet. |
| `eslint` 9 | Version no longer supported | Development only. Waits for `eslint-config-next` to support ESLint 10. |
| `fast-uri` 3.1.8, from `ajv` 8 in `@prisma/dev` | Scheme spoofing, host confusion and path or scheme handling in URI parsing ([GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr), [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp)) | Comes with Prisma's development server (`prisma dev`), which Dossier never runs. Nothing in Dossier imports it. Fixed in 3.1.9; it arrives with Prisma's next update. |
| `source-map-js` 1.2.1, from `postcss` and `@tailwindcss/node` | Event-loop denial of service through indexed source-map offsets ([GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)) | Build time only: it reads the project's own CSS and source maps while compiling. The running server doesn't load it. Fixed in 1.2.2; it arrives with the next PostCSS or Tailwind update. |
| `undici` 8.11.2, from `jsdom` | Eight denial-of-service, cache, TLS and subresource-integrity issues in its HTTP client ([GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472), [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c), [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26), [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm), [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6), [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6)) | Tests only: `jsdom` is the DOM for component tests and talks to no real servers. The app uses Node's own `fetch`, not this copy. Fixed in 8.12.2; it arrives with the next `jsdom` update. |
| `vite` 8.3.1 | Six issues in its dev server and `launch-editor` ([GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg)) | Development only: Vitest uses it to run tests, and its dev server is never started. It isn't in the image. Fixed in 8.3.3. |

`mysql2`, which Prisma's CLI ships but Dossier never loads (it uses PostgreSQL), is pinned to a patched release in `package.json` `resolutions`. Remove the pin once Prisma updates it.
