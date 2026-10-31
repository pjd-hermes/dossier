# Design and plan: follow-up reminders (roadmap step 6)

Status: decisions taken, ready to build. No code written yet.
Decided by PJ on 2026-10-31: draft only when Follow up is pressed; Close it out archives; cadence 7, 14, then close-out at 21 (scaled by the quiet-days setting). Base: fork main with Dossier 1.11.0.

## What upstream already does

"Worth a look" on the dashboard (`worthALook` in `src/lib/dashboard.ts`) already lists a Sent or Screening application
that has had no news for `quietDays` (Settings, default 7), longest silence first, as "No news for N days. A short,
friendly follow-up could help." with an Open button. So the nudge exists. What is missing:

| Gap | Today |
|---|---|
| Silence ignores mail | It counts from the last status change, `sentAt` or `updatedAt`. An employer's reply or a message PJ sent from the Conversation tab doesn't reset it. |
| No draft | The nudge says a follow-up could help; PJ writes it. |
| No memory | Nothing records that a follow-up went out, so the same item returns every day. |
| No way to put it off | No snooze, no "not needed", no end to the nudging. |
| No close-out | A silent application stays in Sent forever. |

This step fixes those. It does not replace the existing nudge; it builds on it.

## Goal

When an application goes quiet, Dossier says so, offers a drafted follow-up in the same Gmail thread (or to copy), remembers
what was done, backs off, and finally suggests closing the application out. It never sends by itself.

### Success criteria

- Silence is measured from the latest of: last status change, `sentAt`, the newest `EmailMessage` (either direction) and the newest follow-up sent.
- After a follow-up is marked sent, the item is gone until the next threshold; after the last threshold the item offers "Close it out".
- Snooze and "Not needed" take effect at once and survive restarts.
- Drafting uses the AI provider and the fact guard like the application email, and sends nothing without a button press.
- An upgrade changes nothing for an install that ignores the feature, except that the silence now counts mail.
- Coverage gates (86 % overall, 94 % `src/lib`), `session-audit.test.ts`, and the export, import, delete-everything and backup paths all pass.

## Design

### Cadence

Let `q` be the existing `quietDays` setting and `n` the number of follow-ups already sent for the application.

| Stage | Shows when silence reaches | Item says | Button |
|---|---|---|---|
| First follow-up | `q` days | No news for N days | Follow up |
| Second follow-up | `2q` days after the last activity, if `n = 1` | You followed up on DATE | Follow up again |
| Close-out | `3q` days, if `n >= 2`, or `4q` with `n = 0` | No answer in N days. Time to close it out? | Close it out |

"Close it out" moves the application to Archived (Dossier's `archivedAt`), not to Rejected, so the funnel's rejected count isn't
polluted by silence. A later reply reopens the item through the normal inbox flow.

### Data (one migration, one new model, no change to `Application`)

```prisma
/// A follow-up on a quiet application (step 6): the draft, and what was done with it.
model FollowUp {
  id            String      @id @default(cuid())
  applicationId String
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  /// 1 for the first follow-up of the application, 2 for the second.
  attempt       Int
  subject       String      @default("")
  body          String      @default("")
  /// The prompt version that wrote it, e.g. "write-follow-up@1"; null for one written by hand.
  draftedWith   String?
  /// Marked sent, or sent through Gmail.
  sentAt        DateTime?
  /// The Gmail message, when it went out through Dossier.
  gmailId       String?
  /// "Not needed": the stage is skipped.
  skippedAt     DateTime?
  /// Hidden from Worth a look until then.
  snoozedUntil  DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@index([applicationId, attempt])
}
```

Why a table and not settings JSON (rule 2 in `FORK.md`): it is per-application, grows with use, must be deleted with its
application, and holds text the export must carry. `Application` gets only a relation field (`followUps FollowUp[]`), one
line in `FORK.md`. If PJ would rather avoid even that, the same rows can hang off `Note`; the plan says why that is worse (notes are free text, not drafts).

New settings (JSON, no migration): `followUpsOn` (boolean, default `true`: the existing nudge is already on) and
`followUpDraftAhead` (boolean, default `false`: draft only when PJ presses Follow up).

### Silence

New `src/lib/follow-ups/silence.ts`: `lastActivity(application, mail, followUps)` and `nextStage(...)`, pure functions with the
table above. `worthALook` gets a thin call: its `quiet` list comes from `nextStage` instead of the inline `silence`. The
dashboard data loader (`dashboard-data.ts`) passes the newest mail date and follow-up state per application, the way it
passes `replies` today.

### Drafting

- New AI task `src/lib/ai/tasks/write-follow-up.ts`, `write-follow-up@1`, modelled on `write-email@2`: input is the profile, the
  extracted posting, tone, facts, the application's last email thread (subject and a one-line summary per message, from `EmailMessage.summary`), days of silence and the attempt number.
  Output is `subject`, `greeting`, `paragraphs` (two short ones, 40 to 80 words together), `signOff`. It must not repeat the cover letter, must not invent anything not in the profile or facts (fact guard, as `write-email`), and on attempt 2 must be shorter and must not guilt the reader.
- New job `src/lib/jobs/write-follow-up.ts` using the existing job infrastructure, keyed per application so a double click doesn't run twice.
- Sending: if the application has an `emailThreadId` and Google is connected, a **Send in the thread** button uses the existing Gmail
  send path (reply in thread, recipient from the last outgoing message); otherwise **Copy** and **Open in mail app** (`mailtoHref`), as on the Email tab. Either way, a **Mark as sent** records `sentAt`.
- The follow-up always shows the draft first; nothing is sent without a press, in line with the app's existing promise.

### Screens

- Dashboard, Worth a look: the item's button becomes **Follow up** (and "Close it out" at the last stage), plus a small menu: Snooze 3 days, Snooze 7 days, Not needed.
- Application, Conversation tab: a **Follow-up** card above the thread while a stage is due or a draft exists, with the draft (editable like other text units), Send, Copy, Mark as sent, Snooze, Not needed. After sending it shows "Followed up on DATE" in the thread's history.
- Settings, a line under the existing quiet-days choice: switch for follow-ups, switch for drafting ahead.

### Out of scope

- Auto-sending. Follow-ups to anyone but the thread's last recipient. Reminders by email or push. A calendar entry. (All can follow later.)
- MCP tool for follow-ups: optional last task, see below.

## Decisions for PJ

| Question | Recommendation |
|---|---|
| Draft ahead in the background, or only when pressed? | Only when pressed (cost, and drafts go stale). The setting exists if you change your mind. |
| Close-out archives, or marks Rejected? | Archive. It keeps the funnel honest. |
| Cadence `q`, `2q`, `3q`? | Yes, with the existing 7-day default: 7, then 14 after the first, then 21. |
| Interview status with no date? | Out of scope; the existing item covers it. |

## Tasks

Each task is a branch-sized unit; PJ merges and smoke-tests, as for step 2.

1. **Silence that counts mail.** `src/lib/follow-ups/silence.ts` with tests (status change, sent date, incoming and outgoing mail, follow-ups, archived). `worthALook` and the dashboard loader use it. Visible effect: a reply or a sent message resets the nudge. No migration.
2. **`FollowUp` model and its paths.** Migration; relation on `Application`; export schema (`data-export.ts`) with defaults for older files; import; delete-everything; backup; their tests. Round-trip test with and without follow-ups.
3. **Cadence and state.** `nextStage` with the table above, plus actions `snoozeFollowUp`, `skipFollowUp`, `markFollowUpSent`, `closeOut` (all `action()` + `verifySession()`), with db tests. The dashboard shows the new wording and the menu.
4. **The draft.** `write-follow-up` task, its job, fact guard, prompt-version constant, and unit tests with the fake provider as the other tasks do. One live test beside the existing ones (skipped without a key).
5. **The Conversation tab card.** Draft view, edit, Copy, Open in mail app, Mark as sent; the Gmail send in thread when connected (db test with the Gmail fake).
6. **Settings and docs.** The two switches, the README feature line, `DEVELOPMENT.md` section, `FORK.md` rows for every upstream file touched.
7. **Optional: MCP.** `list_follow_ups` and `draft_follow_up` for the connector, read-only plus saving a draft, never sending.

## Manual follow-up (PJ)

- Smoke-test with a real Gmail thread and a real provider key: draft, send in thread, mark sent, snooze, close-out.
- Check the wording of the three item texts and the draft's tone on an application PJ actually sent.

## Merge-tax check

New `action()`s go through `verifySession()`; the new model needs the export, import, delete-everything and backup paths and tests (task 2); `src/lib` additions are pure and tested to the 94 % gate. Upstream files touched, to be listed in `FORK.md` as each task lands: `prisma/schema.prisma`, `src/lib/dashboard.ts`, `src/lib/dashboard-data.ts`, `src/lib/data-export.ts`, `src/lib/data-import.ts`, `src/lib/settings.ts`, the dashboard and Conversation tab components, and `src/lib/ai/tasks/index.ts`.
