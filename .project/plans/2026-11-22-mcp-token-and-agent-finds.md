# MCP access tokens and agent-find vetting: Design and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let n8n (and Claude) reach Dossier's MCP endpoint with a named access token instead of OAuth, and give them tools to read the job agent's recent finds, vet them, record a verdict, and dismiss scams.

**Architecture:** A third way through the existing gate in `src/app/api/mcp/route.ts` (`verifyAccessToken`): named tokens kept hashed in the settings JSON, each with a scope (`read` or `dismiss`). The new tools sit in new files and reuse `dismissPosting` / `unmarkPosting` (`src/lib/postings.ts`), `listLibrary`-style Posting reads, `companyKey` (`src/lib/dedupe.ts`) and the agent's `AgentCandidate` rows. One new nullable `Posting.vetting` JSON column holds verdicts.

**Tech Stack:** Next.js, Prisma (PostgreSQL + SQLite, two migrations), `@modelcontextprotocol/server`, zod, vitest.

**Spec:** the Design section of this file. Written 2026-11-22 from PJ's decisions in the project thread: option A (named tokens), all five tools, track in both Dossier and n8n.

---

## Design

### Intent
PJ's job agent finds postings on a schedule. Today only the user can look at them. PJ wants, after each agent run, n8n (or Claude) to read the new finds, check the company, the salary and whether the posting is legitimate, dismiss the scams, and keep a record, without PJ asking each time. Claude chat's OAuth connector can't be driven by n8n, so a token is needed.

### Goals
- Named access tokens, created and revoked in Settings → MCP connector, shown once, stored hashed.
- Two scopes: `read` (only tools annotated `readOnlyHint`) and `dismiss` (read plus `dismiss_posting`, `restore_posting`, `record_vetting`). OAuth tokens (Claude) keep today's full access.
- Five new tools: `list_agent_finds`, `company_history`, `dismiss_posting`, `restore_posting`, `record_vetting`.
- Verdicts tracked in Dossier (`Posting.vetting`, shown in Positions) as well as by n8n.

### Non-goals / anti-goals
- No tool starts an agent run (spends portal quota) or sends anything.
- No tool deletes or archives (existing rule in `connector/tools.ts`); dismiss is reversible with `restore_posting`.
- No second store of postings or dismissals: new tools call the existing functions. A token must never be able to do more than its scope, and a token must never appear in an export, log or error.
- No change to OAuth behaviour for Claude.

### Constraints (from the codebase and FORK.md)
- New logic goes in new files; upstream files get thin calls (FORK.md rule 1). Every upstream file touched goes in FORK.md's "Upstream files we change" table.
- Settings JSON before new tables (rule 2): tokens live in settings. `Posting.vetting` is a column because it's per posting; this is the fork's first schema change since the sync, so it needs both migrations, `yarn sqlite-schema`, and export/import/delete-everything coverage.
- New server actions use `action()`; `session-audit.test.ts` must stay green. Coverage thresholds in `vitest.config.mts` apply.
- Tokens work only while the connector is on (`connectorSince()` non-null); off still answers 404.

### Approaches considered
1. **Named tokens in settings JSON, hashed (chosen).** Individually revocable, scoped, no table. Cost: a settings key, a small UI.
2. One long-lived signed token like OAuth's. No storage, but only revocable via Disconnect, which also signs Claude out; no scopes.
3. n8n via full OAuth. n8n's MCP client can't complete Dossier's browser sign-in unattended.

### Decisions
- Token format `dsr_` + 32 random bytes base64url. Stored: `{ id, name, scope, hash (sha256 hex), createdAt, lastUsedAt }`. Looked up by hash, compared with `timingSafeEqual`. Max 10 tokens. (My call: the limit.)
- "Disconnect all apps" signs OAuth apps out but leaves named tokens, which are revoked one by one. Turning the connector off closes everything with a 404. (My call.)
- `Posting.vetting Json?`: `{ verdict: "legit"|"doubtful"|"scam", note: string (≤1000), checks: {name: string, result: string}[] (≤20), checkedBy: string, checkedAt: ISO }`. `checkedBy` is the token's name, or "Claude" for OAuth.
- `dismiss_posting` records a `scam`/`doubtful` verdict with the reason, then dismisses, so the reason survives `dismissPosting` trimming the text. A merged posting (`mergedIntoId` set) is refused with a pointer to the posting it shows as. (My call.)
- `list_agent_finds` returns postings found by agent runs (`PostingFind` → `PostingSearch.agentSearchId` not null), newest first, excluding dismissed, removed and merged ones; with the matching `AgentCandidate`'s `redFlags`, coverage and skip reason when there is one.

---

## Global Constraints
- Tool names exactly: `list_agent_finds`, `company_history`, `dismiss_posting`, `restore_posting`, `record_vetting`.
- Token prefix `dsr_`; scopes exactly `"read"` and `"dismiss"`; settings key `connectorTokens`; max 10 tokens.
- Verdict values exactly `"legit"`, `"doubtful"`, `"scam"`.
- Branch: `claude/project-thread-e98yta` unless PJ names another. Commit trailer lines as the session instructs.
- Run tests the Docker way (`docker/bin/yarn test`, `typecheck`, `lint`), DB tests on Postgres and SQLite.

## Review Focus
1. A revoked token, or any token while the connector is off, is rejected on the very next request (401 / 404), never cached.
2. A `read` token calling `dismiss_posting` or `save_application` gets "unknown tool", not an error that confirms it exists; `tools/list` doesn't show them.
3. The raw token appears once in the create response and nowhere else: not in settings JSON, the export, logs, error messages or `lastUsedAt` updates.
4. Dismissing an already-dismissed, merged, unknown or removed posting is a clear message, never a crash or a silent double write; restoring one that isn't dismissed is a no-op with a message.
5. `list_agent_finds` with a huge `since` range, an empty database, a deleted agent search, or `limit` past the maximum stays bounded and ordered stably (ties by id).
6. `company_history` with an empty company name must not match every company without one.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/sqlite/schema.prisma` (derived) | `Posting.vetting Json?` |
| `prisma/migrations/20261201090000_posting_vetting/`, `prisma/sqlite/migrations/20261201090000_posting_vetting/` | The column, both databases |
| `src/lib/connector/tokens.ts` (new) | Create, list, revoke, verify named tokens |
| `src/lib/connector/scopes.ts` (new) | Which tools each scope may use |
| `src/lib/vetting.ts` (new) | `vettingSchema`, `recordVetting`, `dismissWithReason`, `restorePosting` |
| `src/lib/agent-finds.ts` (new) | `listAgentFinds`, `companyHistory` queries |
| `src/lib/connector/vetting-tools.ts` (new) | Registers the five tools on a server |
| `src/lib/connector/tools.ts` (modify) | Thin calls: scope parameter, register the new tools |
| `src/app/api/mcp/route.ts` (modify) | Accept named tokens beside OAuth, pass scope and name on |
| `src/lib/settings.ts`, `src/lib/data-export.ts` (modify) | `connectorTokens` setting, kept out of exports (`SECRET_SETTINGS`) |
| `src/app/(app)/settings/actions.ts`, `page.tsx`, new `connector-tokens.tsx` (modify/create) | Create/revoke UI |
| Positions posting view (find it: grep `dismissedAt` under `src/app/(app)/jobs`) | Show the verdict |
| `FORK.md`, `.project/roadmap.md` | Fork table and plan status |

---

### Task 1: `Posting.vetting` column

**Files:**
- Modify: `prisma/schema.prisma` (model `Posting`, after `removedAt`)
- Create: both migration folders named above; run `yarn sqlite-schema` to regenerate `prisma/sqlite/schema.prisma`
- Modify: `src/lib/data-export.ts`, `src/lib/data-import.ts` (postings carry `vetting`), plus their tests: `data-import.db.test.ts`, `delete-everything.db.test.ts`
- Test: `src/lib/data-export.db.test.ts` (or the existing export round-trip test; find it with grep)

**Interfaces:**
- Produces: `Posting.vetting: Prisma.JsonValue | null`.

- [ ] **Step 1: Write the failing test.** In the existing export/import round-trip test, give a seeded posting `vetting: { verdict: "scam", note: "Asks for a fee", checks: [], checkedBy: "n8n", checkedAt: "2026-11-22T00:00:00.000Z" }`; assert the exported postings entry has `vetting` equal to it and an import into an empty database restores it. Add `vetting` to the delete-everything assertions if they list columns.
- [ ] **Step 2: Run it, expect FAIL** (unknown field `vetting`): `docker/bin/yarn vitest run src/lib/data-export`.
- [ ] **Step 3: Add the column** `vetting Json?` with a `///` comment ("What was found out about whether it's a real posting (E-fork): verdict, note and checks"), run `yarn sqlite-schema`, write both migrations (a plain `ALTER TABLE "Posting" ADD COLUMN "vetting" JSONB` / SQLite `JSONB`-equivalent as the neighbouring migrations do), and carry the field through export and import of postings.
- [ ] **Step 4: Run** the export/import/delete-everything tests and the schema-match test on both databases; expect PASS.
- [ ] **Step 5: Commit** `feat: Posting.vetting column`.

### Task 2: Named token store

**Files:**
- Create: `src/lib/connector/tokens.ts`, `src/lib/connector/tokens.test.ts`
- Modify: `src/lib/settings.ts` (add `connectorTokens` zod schema, default `[]`), `src/lib/data-export.ts` (`SECRET_SETTINGS` gets `"connectorTokens"`; and `INSTALL_SETTINGS` too so an import never adds one)

**Interfaces:**
- Produces:
  - `type TokenScope = "read" | "dismiss"`
  - `type TokenInfo = { id: string; name: string; scope: TokenScope; createdAt: string; lastUsedAt: string | null }`
  - `createToken(input: { name: string; scope: TokenScope }): Promise<{ token: string; info: TokenInfo }>` (throws `Error("That's 10 tokens already.")` past the limit; trimmed, non-empty, unique name ≤60 chars)
  - `listTokens(): Promise<TokenInfo[]>`
  - `revokeToken(id: string): Promise<void>`
  - `verifyStaticToken(token: string | null | undefined): Promise<{ id: string; name: string; scope: TokenScope } | null>` (null without the `dsr_` prefix, on no match, and while `connectorSince()` is null; updates `lastUsedAt` at most once a minute)

- [ ] **Step 1: Write failing tests** (mock `settings-data` as `oauth.test.ts` does): `createToken` returns a `dsr_` token whose raw text is absent from the stored settings; `verifyStaticToken(token)` returns `{ name, scope }`; a wrong or unprefixed token returns null; after `revokeToken(id)` the same token returns null; with `connectorEnabledAt: null` it returns null; the 11th `createToken` rejects; a duplicate name rejects; `listTokens()` never includes `hash`.
- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement** in `tokens.ts`: `randomBytes(32).toString("base64url")`, `createHash("sha256")` hex, `timingSafeEqual` on equal-length buffers, `loadSettings`/`saveSettings` for storage.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: named connector tokens`.

### Task 3: The gate accepts tokens, tools respect scope

**Files:**
- Create: `src/lib/connector/scopes.ts`
- Modify: `src/app/api/mcp/route.ts`, `src/lib/connector/tools.ts` (`createDossierServer(origin: string, access: ConnectorAccess = FULL_ACCESS)`)
- Test: `src/app/api/mcp/route.test.ts`, `src/lib/connector/tools.db.test.ts`

**Interfaces:**
- Produces in `scopes.ts`: `type ConnectorAccess = { scope: "full" | TokenScope; name: string }`, `const FULL_ACCESS: ConnectorAccess = { scope: "full", name: "Claude" }`, `toolAllowed(access: ConnectorAccess, tool: { name: string; readOnly: boolean }): boolean` (full: all; read: `readOnly` only; dismiss: read-only plus `dismiss_posting`, `restore_posting`, `record_vetting`).
- Consumes: `verifyStaticToken` (Task 2).

- [ ] **Step 1: Write failing tests.** Route: a `dsr_` token for a `read` scope gets 200 on `tools/list`, and the list lacks `save_application`, `set_application_status`, `save_job_scores`, `search_jobs` (it's `readOnlyHint: false` and spends portal quota, so it is absent for `read` too). Assert the list has `get_profile`, `get_posting`, `list_applications`, `get_application`, `check_draft`. A revoked token gets 401 with the same `www-authenticate` header as today. Connector off gives 404. An OAuth token still lists all twelve existing tools.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In `route.ts`, try `verifyStaticToken(token)` before `verifyAccessToken`; pass `access` in `authInfo.extra` and build the server with it. In `createDossierServer`, apply `toolAllowed` when registering (use the SDK's registered-tool handle to disable or remove, or skip registering; confirm `tools/list` output in the test).
- [ ] **Step 4: Run, expect PASS** (route, tools tests, `session-audit`).
- [ ] **Step 5: Commit** `feat: MCP accepts named tokens, scoped`.

### Task 4: Vetting library

**Files:**
- Create: `src/lib/vetting.ts`, `src/lib/vetting.db.test.ts`

**Interfaces:**
- Consumes: `dismissPosting(found: FoundPosting)`, `unmarkPosting(ref, "dismissed", { saved })`, `foundFromPosting(row)` from `src/lib/postings.ts`.
- Produces:
  - `vettingSchema` (zod, shape in Design)
  - `type Vetting = z.infer<typeof vettingSchema>`
  - `recordVetting(postingId: string, input: { verdict; note; checks? }, checkedBy: string): Promise<{ ok: true } | { ok: false; message: string }>`
  - `dismissWithReason(postingId: string, input: { reason: string; verdict?: "doubtful" | "scam" }, checkedBy: string): Promise<{ ok: true; wasSaved: boolean } | { ok: false; message: string }>`
  - `restorePosting(postingId: string): Promise<{ ok: true; restored: boolean } | { ok: false; message: string }>`

- [ ] **Step 1: Write failing DB tests** (as `postings` db tests do): `recordVetting` stores the verdict and `checkedAt`; unknown id gives `{ ok: false }`; `dismissWithReason` sets `dismissedAt`, empties the description (existing trim), keeps `vetting.note === reason` with verdict `scam` by default, and flips a matching `AgentCandidate` from `SCORED` to `DISMISSED`; refuses a posting with `mergedIntoId` and names the one it shows as; a second dismiss reports it was already dismissed and writes nothing; `restorePosting` clears `dismissedAt`, returns the candidate to `SCORED`, keeps `vetting`; restoring a not-dismissed posting returns `restored: false`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** by calling the existing functions; no new dismissal logic. Parse `vetting` JSON with `vettingSchema.safeParse` on read so a bad stored value reads as null.
- [ ] **Step 4: Run, expect PASS** on Postgres and SQLite.
- [ ] **Step 5: Commit** `feat: vetting and dismiss with a reason`.

### Task 5: Agent finds and company history queries

**Files:**
- Create: `src/lib/agent-finds.ts`, `src/lib/agent-finds.db.test.ts`

**Interfaces:**
- Consumes: `companyKey(name: string): string` from `src/lib/dedupe.ts`; `vettingSchema`.
- Produces:
  - `listAgentFinds(options: { since?: Date; agentSearch?: string; onlyUnvetted?: boolean; limit?: number; cursor?: string }): Promise<{ finds: AgentFind[]; next: string | null }>`; `limit` default 30, max 100; `agentSearch` matches id or case-insensitive name; ordered by `PostingFind.foundAt` desc then id; `cursor` opaque.
  - `type AgentFind = { postingId: string; title; company; place; remote: boolean | null; salary; url; via; portals: string[]; foundAt: string; agentSearch: string | null; vetting: Vetting | null; redFlags: string[]; covered: number; requirements: number; mustMissing: number; skipReason: string | null }`
  - `companyHistory(input: { postingId?: string; company?: string }): Promise<{ company: string; postings: { postingId; title; place; salary; firstFound; lastFound; dismissed: boolean; vetting: Vetting | null }[]; applications: number; scamsVetted: number } | { error: string }>` (by `matchCompany`; an empty company name is an error, not a match-all).

- [ ] **Step 1: Write failing tests** with seeded postings: finds from a user search are excluded, from an agent search included; dismissed, removed (`removedAt`) and merged postings excluded; `since` filters; `onlyUnvetted` hides postings with `vetting`; the candidate's `redFlags` and coverage come through; pagination returns every find exactly once across pages; `limit: 500` is clamped to 100; a find whose agent search was deleted still lists (name from `agentSearchName`). `companyHistory` counts same-company postings and applications, and returns an error for a posting with no company.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with `prisma.postingFind.findMany` including `posting`, `search`; join candidates by `source` + `externalId` in one extra query, not one per row.
- [ ] **Step 4: Run, expect PASS** on both databases.
- [ ] **Step 5: Commit** `feat: agent finds and company history queries`.

### Task 6: The five tools

**Files:**
- Create: `src/lib/connector/vetting-tools.ts`, `src/lib/connector/vetting-tools.db.test.ts`
- Modify: `src/lib/connector/tools.ts` (one call: `registerVettingTools(server, { linkTo, access })` before `return server`)

**Interfaces:**
- Consumes: Tasks 3 to 5.
- Produces: `registerVettingTools(server: McpServer, deps: { linkTo: (path: string) => string; access: ConnectorAccess }): void`, registering:
  - `list_agent_finds` (readOnly): inputs `since` (ISO date string), `agent_search`, `only_unvetted`, `limit`, `cursor`; output `{ finds, next, link }`.
  - `company_history` (readOnly): inputs `posting_id` or `company`.
  - `record_vetting`: `posting_id`, `verdict`, `note`, `checks`.
  - `dismiss_posting`: `posting_id`, `reason` (≤300), `verdict` (`doubtful`|`scam`, default `scam`).
  - `restore_posting`: `posting_id`.
  Descriptions must say what each does in the style of the existing tools and that dismiss is reversible; the three write tools set `readOnlyHint: false`, `idempotentHint: true`.

- [ ] **Step 1: Write failing tests** (call through `POST /api/mcp` like `tools.db.test.ts`): with a `dismiss` token the full cycle works (`list_agent_finds` → `company_history` → `record_vetting` → `dismiss_posting` → `restore_posting`) and `checkedBy` equals the token's name; with a `read` token the three write tools are unlisted and a direct `tools/call` of `dismiss_posting` returns an error; with OAuth every tool is present; invalid input (bad verdict, missing reason) returns `isError`, not a throw.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** thin handlers calling the library functions; reuse `text()` and `failure()` helpers by exporting them from a shared spot rather than copying (small refactor in `tools.ts` allowed: export both).
- [ ] **Step 4: Run, expect PASS**; also `yarn typecheck`, `lint`, `knip` (unused exports).
- [ ] **Step 5: Commit** `feat: agent find and vetting tools`.

### Task 7: Settings UI for tokens

**Files:**
- Modify: `src/app/(app)/settings/actions.ts`, `src/app/(app)/settings/page.tsx`
- Create: `src/app/(app)/settings/connector-tokens.tsx`, its test, and a settings actions DB test case in `actions.db.test.ts`

**Interfaces:**
- Produces actions (via `action()`): `createConnectorToken({ name: string, scope: "read" | "dismiss" }) → { token: string, info: TokenInfo }`, `revokeConnectorToken({ id: string }) → { tokens: TokenInfo[] }`.

- [ ] **Step 1: Write failing tests:** the actions fail with "The MCP connector is off." while it's off; creating returns the raw token once; the component shows the token with a copy button and a "You won't see this again" note, lists name, scope, created and last used, and Revoke removes the row; copy says "read: can look; dismiss: can also dismiss and record verdicts".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** inside the existing MCP connector card as a "Access tokens" subsection; reuse the card's styles and the Redirect section's patterns.
- [ ] **Step 4: Run** unit and `session-audit`; expect PASS.
- [ ] **Step 5: Commit** `feat: access tokens in Settings`.

### Task 8: Show the verdict in Positions

**Files:**
- Modify: the Positions posting detail/list component (find with `grep -rn "dismissedAt" "src/app/(app)/jobs"`); `src/lib/library.ts` `ShownPosting` only if the state needs to carry `vetting` (prefer adding it to the posting state from `postingStates`).
- Test: that component's test

- [ ] **Step 1: Write failing test:** a posting with a `scam` verdict shows "Marked as a scam" and the note; `doubtful` shows "Doubtful"; `legit` shows "Checked: looks real"; none shows nothing.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** a small `VettingBadge` in a new file, called from the existing component.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: show vetting verdicts in Positions`.

### Task 9: Docs, fork table, and a real check

**Files:**
- Modify: `FORK.md` (upstream-files table: `route.ts`, `tools.ts`, `settings.ts`, `data-export.ts`, `data-import.ts`, `prisma/schema.prisma`, `settings/actions.ts`, `settings/page.tsx`, the Positions component; "Files only this fork has": the new files; one line on `Posting.vetting` and the migration), `.project/roadmap.md` (status), and `.project/plans/` (this file, marked done).

- [ ] **Step 1: Update the docs** as listed, plus a short "n8n setup" note in FORK.md: add an MCP Client node, URL `<address>/api/mcp`, header `Authorization: Bearer dsr_...`.
- [ ] **Step 2: Run the whole suite:** `docker/bin/yarn test`, `typecheck`, `lint`, `knip`; DB tests on Postgres and SQLite; coverage gates. Expect all green.
- [ ] **Step 3: Try it in a local stack** (production compose as in the 1.15.1 test): turn the connector on, create a `dismiss` token, then `curl -s -H "Authorization: Bearer dsr_..." -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:3000/api/mcp` lists the five new tools; revoke the token and the same call returns 401.
- [ ] **Step 4: Commit** `docs: fork notes for tokens and vetting`, push, open the PR. Tagging a release (`v1.15.1-pjd.0.3.0`) is PJ's call afterwards.

---

## Self-review
- Spec coverage: tokens (T2, T3, T7), scopes (T3), five tools (T6 over T4, T5), tracking in Dossier (T1, T4, T8), tracking in n8n (record_vetting output and list filters, T5/T6), docs (T9).
- Names are consistent: `ConnectorAccess`/`FULL_ACCESS` (T3, T6), `Vetting`/`vettingSchema` (T4, T5), `verifyStaticToken` (T2, T3).
- Not verified yet, implementer to check first: whether `@modelcontextprotocol/server` exposes enable/remove on a registered tool (T3 falls back to skipping registration); the exact name of the existing export round-trip test (T1); which component shows a posting in Positions (T8).
