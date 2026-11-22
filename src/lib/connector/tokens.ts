import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { z } from "zod";

import { connectorTokenSchema } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { connectorSince } from "./oauth";

// Fork: named access tokens for the MCP endpoint (src/app/api/mcp), for apps
// that can't sign in through OAuth, such as n8n. Each has a name and a scope
// ("read" looks, "dismiss" also dismisses and records verdicts, scopes.ts),
// is shown once when it's made, and is kept only as a SHA-256 hash in the
// settings, so it can be revoked on its own. They work only while the
// connector is on. They're the install's: exports leave them out.

export type TokenScope = "read" | "dismiss";
export type TokenInfo = { id: string; name: string; scope: TokenScope; createdAt: string; lastUsedAt: string | null };

const PREFIX = "dsr_";
const MAX_TOKENS = 10;
const MAX_NAME = 60;
/** A token's last use is written at most this often, so a busy workflow doesn't write on every request. */
const TOUCH_MS = 60_000;

type Stored = z.infer<typeof connectorTokenSchema>;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const info = ({ id, name, scope, createdAt }: Stored, use: Record<string, string> = {}): TokenInfo => ({ id, name, scope, createdAt, lastUsedAt: use[id] ?? null });

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Makes a token: the text is returned here once and never kept. */
export async function createToken({ name, scope }: { name: string; scope: TokenScope }): Promise<{ token: string; info: TokenInfo }> {
  const clean = name.trim();
  if (!clean) throw new Error("Give the token a name.");
  if (clean.length > MAX_NAME) throw new Error(`At most ${MAX_NAME} characters.`);
  const { connectorTokens } = await loadSettings();
  if (connectorTokens.length >= MAX_TOKENS) throw new Error(`That's ${MAX_TOKENS} tokens already.`);
  if (connectorTokens.some((entry) => entry.name.toLowerCase() === clean.toLowerCase())) throw new Error("There's a token with that name already.");
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const stored: Stored = { id: randomUUID(), name: clean, scope, hash: hashOf(token), createdAt: new Date().toISOString() };
  await saveSettings({ connectorTokens: [...connectorTokens, stored] });
  return { token, info: info(stored) };
}

export async function listTokens(): Promise<TokenInfo[]> {
  const { connectorTokens, connectorTokenUse } = await loadSettings();
  return connectorTokens.map((entry) => info(entry, connectorTokenUse));
}

export async function revokeToken(id: string): Promise<void> {
  const { connectorTokens, connectorTokenUse } = await loadSettings();
  const use = Object.fromEntries(Object.entries(connectorTokenUse).filter(([key]) => key !== id));
  await saveSettings({ connectorTokens: connectorTokens.filter((entry) => entry.id !== id), connectorTokenUse: use });
}

/** Whose token this is, if it's one of ours and the connector is on. */
export async function verifyStaticToken(token: string | null | undefined): Promise<{ id: string; name: string; scope: TokenScope } | null> {
  if (!token?.startsWith(PREFIX) || token.length <= PREFIX.length) return null;
  if (!(await connectorSince())) return null;
  const { connectorTokens, connectorTokenUse } = await loadSettings();
  const hash = hashOf(token);
  const found = connectorTokens.find((entry) => sameHash(entry.hash, hash));
  if (!found) return null;
  const now = Date.now();
  const last = connectorTokenUse[found.id];
  if (!last || now - Date.parse(last) > TOUCH_MS) await saveSettings({ connectorTokenUse: { ...connectorTokenUse, [found.id]: new Date(now).toISOString() } });
  return { id: found.id, name: found.name, scope: found.scope };
}
