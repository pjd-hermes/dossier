import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsData } from "@/lib/settings";

const store = vi.hoisted(() => ({ settings: { connectorEnabledAt: "2026-10-23T09:00:00.000Z" as string | null, connectorTokens: [] as unknown[], connectorTokenUse: {} as Record<string, string> } }));
vi.mock("@/lib/settings-data", () => ({
  loadSettings: async () => store.settings,
  saveSettings: async (changes: Partial<SettingsData>) => void Object.assign(store.settings, changes),
}));

import { createToken, listTokens, revokeToken, verifyStaticToken } from "./tokens";

beforeEach(() => {
  store.settings.connectorEnabledAt = "2026-10-23T09:00:00.000Z";
  store.settings.connectorTokens = [];
  store.settings.connectorTokenUse = {};
});

describe("the connector's named access tokens (fork)", () => {
  it("makes a dsr_ token that verifies as its name and scope, and keeps only its hash", async () => {
    const { token, info } = await createToken({ name: "n8n", scope: "dismiss" });
    expect(token).toMatch(/^dsr_[\w-]{40,}$/);
    expect(JSON.stringify(store.settings)).not.toContain(token);
    expect(await verifyStaticToken(token)).toEqual({ id: info.id, name: "n8n", scope: "dismiss" });
  });

  it("refuses a wrong token, one without the prefix, and a missing one", async () => {
    const { token } = await createToken({ name: "n8n", scope: "read" });
    expect(await verifyStaticToken(`${token}x`)).toBeNull();
    expect(await verifyStaticToken(token.slice(4))).toBeNull();
    expect(await verifyStaticToken("dsr_")).toBeNull();
    expect(await verifyStaticToken(undefined)).toBeNull();
  });

  it("stops working at once when revoked", async () => {
    const { token, info } = await createToken({ name: "n8n", scope: "read" });
    await revokeToken(info.id);
    expect(await verifyStaticToken(token)).toBeNull();
    expect(await listTokens()).toEqual([]);
  });

  it("is refused while the connector is off", async () => {
    const { token } = await createToken({ name: "n8n", scope: "read" });
    store.settings.connectorEnabledAt = null;
    expect(await verifyStaticToken(token)).toBeNull();
  });

  it("allows ten tokens, with names that are different and not empty", async () => {
    for (let n = 1; n <= 10; n++) await createToken({ name: `app ${n}`, scope: "read" });
    await expect(createToken({ name: "eleven", scope: "read" })).rejects.toThrow("That's 10 tokens already.");
    store.settings.connectorTokens = [];
    await createToken({ name: "n8n", scope: "read" });
    await expect(createToken({ name: " N8N ", scope: "read" })).rejects.toThrow("There's a token with that name already.");
    await expect(createToken({ name: "   ", scope: "read" })).rejects.toThrow("Give the token a name.");
    await expect(createToken({ name: "x".repeat(61), scope: "read" })).rejects.toThrow("At most 60 characters.");
  });

  it("lists tokens without their hashes, and records when one was last used", async () => {
    const { token, info } = await createToken({ name: "n8n", scope: "read" });
    expect((await listTokens())[0]).toEqual({ id: info.id, name: "n8n", scope: "read", createdAt: info.createdAt, lastUsedAt: null });
    await verifyStaticToken(token);
    expect((await listTokens())[0]!.lastUsedAt).not.toBeNull();
    expect(Object.keys((await listTokens())[0]!)).not.toContain("hash");
  });

  it("can't be written back by a use that was under way when it was revoked", async () => {
    const { token, info } = await createToken({ name: "n8n", scope: "read" });
    await verifyStaticToken(token);
    await revokeToken(info.id);
    store.settings.connectorTokenUse = { [info.id]: "2026-10-23T09:00:00.000Z" };
    await verifyStaticToken(token);
    expect(store.settings.connectorTokens).toEqual([]);
  });
});
