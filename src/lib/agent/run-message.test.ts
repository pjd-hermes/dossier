import { describe, expect, it } from "vitest";

import type { SkippedSource } from "./plan";
import { failedProblem, runMessage, searchedSentence, skippedProblem } from "./run-message";

const jsearchCapped: SkippedSource = { source: "JSEARCH", reason: "cap", cap: 2, searchIds: ["c"] };

describe("what a run says it searched", () => {
  it("names the providers that ran every search together", () => {
    expect(searchedSentence([["JSEARCH", 3], ["ADZUNA", 3], ["FREEHIRE", 3]], [])).toBe("Searched 3 job types on JSearch, Adzuna and FreeHire.");
    expect(searchedSentence([["FREEHIRE", 1]], [])).toBe("Searched 1 job type on FreeHire.");
  });

  it("names a provider held back by its daily limit apart", () => {
    expect(searchedSentence([["JSEARCH", 2], ["ADZUNA", 3], ["FREEHIRE", 3]], [jsearchCapped])).toBe(
      "Searched 3 job types on Adzuna and FreeHire, and 2 on JSearch (its limit of 2 a day).",
    );
    const usedUp = { ...jsearchCapped, searchIds: ["a", "b", "c"] };
    expect(searchedSentence([["JSEARCH", 0], ["ADZUNA", 3], ["FREEHIRE", 3]], [usedUp])).toBe(
      "Searched 3 job types on Adzuna and FreeHire. JSearch's limit of 2 a day is used up until later.",
    );
    expect(searchedSentence([], [usedUp])).toBe("JSearch's limit of 2 a day is used up until later.");
  });

  it("says which provider was skipped for its key, and which didn't answer", () => {
    expect(skippedProblem("JSEARCH", "Add your JSearch key in Settings → Job search first.")).toBe("JSearch was skipped: Add your JSearch key in Settings → Job search first.");
    expect(failedProblem("JSEARCH", "JSearch didn't accept your key. Check it in Settings → Job search.")).toBe(
      "JSearch didn't answer: JSearch didn't accept your key. Check it in Settings → Job search.",
    );
  });

  it("puts the searched sentence, the problems and the outcome together", () => {
    expect(
      runMessage({
        searched: "Searched 1 job type on Adzuna.",
        problems: ["JSearch was skipped: Add your JSearch key in Settings → Job search first.", "FreeHire didn't answer: FreeHire isn't answering right now. Try again in a minute."],
        tail: "2 new postings are waiting for a look.",
      }),
    ).toBe(
      "Searched 1 job type on Adzuna. JSearch was skipped: Add your JSearch key in Settings → Job search first. FreeHire didn't answer: FreeHire isn't answering right now. Try again in a minute. 2 new postings are waiting for a look.",
    );
    expect(runMessage({ searched: "", problems: [], tail: "No new postings this time." })).toBe("No new postings this time.");
  });
});
