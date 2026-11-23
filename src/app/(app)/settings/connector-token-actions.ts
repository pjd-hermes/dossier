"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { createToken, listTokens, revokeToken, TokenError } from "@/lib/connector/tokens";
import { loadSettings } from "@/lib/settings-data";

// Fork: Settings → MCP connector → Access tokens (src/lib/connector/tokens.ts),
// kept apart from actions.ts so that file stays upstream's.

/** Makes a token. Its text is in the answer once: only a hash is kept. */
export const createConnectorToken = action(z.object({ name: z.string().max(200), scope: z.enum(["read", "dismiss", "draft"]) }), async ({ name, scope }) => {
  if (!(await loadSettings()).connectorEnabledAt) throw new ActionError("The MCP connector is off. Turn it on first.");
  try {
    const { token } = await createToken({ name, scope });
    return { token, tokens: await listTokens() };
  } catch (error) {
    if (error instanceof TokenError) throw new ActionError(error.message);
    throw error;
  }
});

/** Revokes a token: the app that has it is refused from its next request. */
export const revokeConnectorToken = action(z.object({ id: z.string().max(100) }), async ({ id }) => {
  await revokeToken(id);
  return { tokens: await listTokens() };
});
