import { z } from "zod";

// Fork: what Posting.vetting holds (src/lib/vetting.ts writes it), and how
// Positions words it. No "server-only": the screens use it too.

export const VERDICTS = ["legit", "doubtful", "scam"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Who posted the job: the employer itself, a recruiter or agency, or nobody's found out. */
export const SOURCES = ["direct", "recruiter", "unknown"] as const;
export type Source = (typeof SOURCES)[number];

/** A web address, as the direct posting's link: it's shown as a link, so nothing but http(s). */
export const directUrlSchema = z.url({ protocol: /^https?$/ }).max(500);

export const checkSchema = z.object({ name: z.string().trim().min(1).max(80), result: z.string().max(300) });

const vettingSchema = z.object({
  verdict: z.enum(VERDICTS),
  note: z.string().max(1000),
  checks: z.array(checkSchema).max(20),
  /** A verdict recorded before there was a source reads as not known. */
  source: z.enum(SOURCES).default("unknown"),
  /** The employer's own posting, when a recruiter's was the one found. */
  directUrl: directUrlSchema.optional(),
  /** The token's name, or "Claude" for the connector's own sign-in. */
  checkedBy: z.string().max(80),
  checkedAt: z.string(),
});
export type Vetting = z.infer<typeof vettingSchema>;

/** A stored verdict, or null when there is none or it doesn't fit. */
export function vettingOf(value: unknown): Vetting | null {
  const parsed = vettingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** What a posting's state carries to the screens. */
export type PostingVetting = Pick<Vetting, "verdict" | "note" | "checkedBy"> & Partial<Pick<Vetting, "source" | "directUrl">>;

const BADGES: Record<Verdict, string> = { legit: "Checked", doubtful: "Doubtful", scam: "Scam" };
const WORDS: Record<Verdict, string> = { legit: "Looks real", doubtful: "Doubtful", scam: "Marked as a scam" };

/** The short tag in a list row. */
export const vettingBadge = (vetting: PostingVetting | null | undefined): string | null => (vetting ? BADGES[vetting.verdict] : null);

/** The line in a posting's facts: "Marked as a scam · Asks for a fee (n8n)". */
export const vettingFact = (vetting: PostingVetting | null | undefined): string => (vetting ? `${WORDS[vetting.verdict]}${vetting.note ? ` · ${vetting.note}` : ""} (${vetting.checkedBy})` : "");

/** The tag for a posting a recruiter put up; nothing for the rest, which say nothing worth a tag. */
export const sourceBadge = (vetting: PostingVetting | null | undefined): string | null => (vetting?.source === "recruiter" ? "Via recruiter" : null);

/** The employer's own posting, when one was found and it's a web address. */
export const directPostingLink = (vetting: PostingVetting | null | undefined): string | null => {
  const parsed = directUrlSchema.safeParse(vetting?.directUrl);
  return parsed.success ? parsed.data : null;
};
