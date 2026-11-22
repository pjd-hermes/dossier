import { describe, expect, it, vi } from "vitest";

import { providerOption } from "./provider-options";
import { resolveAiConfig } from "./config";
import { createProvider } from "./index";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// The fork's OpenCode Go provider is retired (FORK.md): the sync migration turns a saved one
// into OpenAI-compatible, and these keep a stray OPENCODE_GO (from an older export, say)
// working the same way instead of breaking Settings.
describe("a retired OPENCODE_GO", () => {
  it("is OpenAI-compatible at OpenCode Go's address", () => {
    const config = resolveAiConfig({ provider: "OPENCODE_GO", baseUrl: null, model: "glm-5.3-flash", apiKeyEnc: null }, {} as Parameters<typeof resolveAiConfig>[1]);
    expect(config).toMatchObject({ provider: "OPENCODE_GO", baseUrl: "https://opencode.ai/inference/go/v1", model: "glm-5.3-flash" });
    expect(createProvider(config).kind).toBe("OPENAI");
  });

  it("is listed as OpenAI-compatible", () => {
    expect(providerOption("OPENCODE_GO")).toBe(providerOption("OPENAI"));
  });
});
