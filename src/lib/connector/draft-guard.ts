import "server-only";

import { prisma } from "@/lib/prisma";

// Fork: draft_application (tools.ts) doesn't draft a posting twice. A
// workflow that retries, or runs again after a failure, would otherwise ask
// Dossier's own AI model for the same documents each time.

/** The application already made from this posting, if it's one Dossier has and one exists. */
export async function existingApplicationFor(postingId: string | undefined): Promise<string | null> {
  if (!postingId) return null;
  const row = await prisma.posting.findUnique({ where: { id: postingId }, select: { applicationId: true } });
  return row?.applicationId ?? null;
}
