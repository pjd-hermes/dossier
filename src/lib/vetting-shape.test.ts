import { describe, expect, it } from "vitest";

import { directPostingLink, sourceBadge, vettingOf } from "./vetting-shape";

// What a verdict says about who posted the job (fork): direct, a recruiter, or not known.

const stored = { verdict: "legit", note: "", checks: [], checkedBy: "n8n", checkedAt: "2026-11-22T06:00:00.000Z" };

describe("a verdict's source (fork)", () => {
  it("reads a verdict stored before it existed as one whose source isn't known", () => {
    expect(vettingOf(stored)).toMatchObject({ verdict: "legit", source: "unknown" });
    expect(vettingOf(stored)).not.toHaveProperty("directUrl");
  });

  it("keeps a recruiter source and the direct link", () => {
    expect(vettingOf({ ...stored, source: "recruiter", directUrl: "https://acme.example/jobs/1" })).toMatchObject({ source: "recruiter", directUrl: "https://acme.example/jobs/1" });
  });

  it("reads a verdict with a source or link that doesn't fit as no verdict", () => {
    expect(vettingOf({ ...stored, source: "agency" })).toBeNull();
    expect(vettingOf({ ...stored, directUrl: "ftp://acme.example/jobs/1" })).toBeNull();
    expect(vettingOf({ ...stored, directUrl: `https://acme.example/${"a".repeat(500)}` })).toBeNull();
  });

  it("tags only a recruiter posting", () => {
    expect(sourceBadge({ verdict: "legit", note: "", checkedBy: "n8n", source: "recruiter" })).toBe("Via recruiter");
    expect(sourceBadge({ verdict: "legit", note: "", checkedBy: "n8n", source: "direct" })).toBeNull();
    expect(sourceBadge({ verdict: "legit", note: "", checkedBy: "n8n" })).toBeNull();
    expect(sourceBadge(null)).toBeNull();
  });

  it("gives the direct link only when it's a web address", () => {
    expect(directPostingLink({ verdict: "legit", note: "", checkedBy: "n8n", directUrl: "https://acme.example/jobs/1" })).toBe("https://acme.example/jobs/1");
    expect(directPostingLink({ verdict: "legit", note: "", checkedBy: "n8n", directUrl: "javascript:alert(1)" })).toBeNull();
    expect(directPostingLink({ verdict: "legit", note: "", checkedBy: "n8n" })).toBeNull();
  });
});
