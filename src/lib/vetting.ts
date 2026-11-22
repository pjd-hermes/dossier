import "server-only";

import type { Posting, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { dismissPosting, foundFromPosting, unmarkPosting } from "./postings";
import type { Verdict } from "./vetting-shape";

// Fork: what was found out about whether a posting is real, kept on the
// posting (Posting.vetting) and set from the MCP tools (connector/vetting-tools.ts),
// by n8n or Claude. Dismissing and restoring go through postings.ts, so the
// library, the Archive and the job agent's queue see one dismissal, not two.

type Outcome<T> = ({ ok: true } & T) | { ok: false; message: string };

const GONE = "That posting is no longer in Dossier.";

/** The posting a call acts on, or why it can't: it's gone, or Dossier shows another one for the same job. */
async function actionable(postingId: string): Promise<{ row: Posting } | { message: string }> {
  const row = await prisma.posting.findUnique({ where: { id: postingId } });
  if (!row || row.removedAt) return { message: GONE };
  if (row.mergedIntoId) return { message: `That posting is the same job as ${row.mergedIntoId}, which is the one Dossier shows. Use that posting_id.` };
  return { row };
}

const vettingValue = (input: { verdict: Verdict; note: string; checks?: { name: string; result: string }[] }, checkedBy: string): Prisma.InputJsonValue => ({
  verdict: input.verdict,
  note: input.note,
  checks: input.checks ?? [],
  checkedBy,
  checkedAt: new Date().toISOString(),
});

export async function recordVetting(
  postingId: string,
  input: { verdict: Verdict; note: string; checks?: { name: string; result: string }[] },
  checkedBy: string,
): Promise<Outcome<unknown>> {
  const target = await actionable(postingId);
  if (!("row" in target)) return { ok: false, message: target.message };
  await prisma.posting.update({ where: { id: target.row.id }, data: { vetting: vettingValue(input, checkedBy) } });
  return { ok: true };
}

/** Records why, then dismisses: out of later searches and the job agent's queue. The reason stays when the text is trimmed. */
export async function dismissWithReason(
  postingId: string,
  input: { reason: string; verdict?: "doubtful" | "scam" },
  checkedBy: string,
): Promise<Outcome<{ wasSaved: boolean }>> {
  const target = await actionable(postingId);
  if (!("row" in target)) return { ok: false, message: target.message };
  if (target.row.dismissedAt) return { ok: false, message: "That posting is dismissed already." };
  await prisma.posting.update({ where: { id: target.row.id }, data: { vetting: vettingValue({ verdict: input.verdict ?? "scam", note: input.reason }, checkedBy) } });
  const { wasSaved } = await dismissPosting(foundFromPosting(target.row));
  return { ok: true, wasSaved };
}

/** Undoes a dismissal, as Undo does: back in the library and the agent's queue. What was found out stays. */
export async function restorePosting(postingId: string): Promise<Outcome<{ restored: boolean }>> {
  const row = await prisma.posting.findUnique({ where: { id: postingId } });
  if (!row || row.removedAt) return { ok: false, message: GONE };
  if (!row.dismissedAt) return { ok: true, restored: false };
  await unmarkPosting({ source: row.source, externalId: row.externalId }, "dismissed");
  return { ok: true, restored: true };
}
