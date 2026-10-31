import { describe, expect, it, vi } from "vitest";

import { resolveJobSearchConfig } from "./config";
import { agentSources, sourceProblem } from "./providers-on";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const saved = {
  jobSource: null,
  jobSourcesOn: ["JSEARCH", "FREEHIRE", "ARBEITSAGENTUR"] as ("JSEARCH" | "FREEHIRE" | "ARBEITSAGENTUR")[],
  jsearchKeyEnc: null,
  jsearchHost: "openwebninja" as const,
  adzunaAppId: null,
  adzunaKeyEnc: null,
  arbeitsagenturAcceptedAt: null,
};
const config = resolveJobSearchConfig(saved, {});

describe("agentSources", () => {
  it("leaves out the Bundesagentur für Arbeit", () => {
    expect(agentSources(config)).toEqual(["JSEARCH", "FREEHIRE"]);
  });
});

describe("sourceProblem", () => {
  it("says what is missing", () => {
    expect(sourceProblem(config, "JSEARCH")).toMatch(/key/i);
  });

  it("is null when the source can be searched", () => {
    expect(sourceProblem(config, "FREEHIRE")).toBeNull();
  });
});
