import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";

import type { TokenScope } from "./tokens";

// Fork: what an access token (tokens.ts) may use. Claude's own sign-in
// (OAuth) keeps every tool, as before.
//   read:    the tools that only look (annotated readOnlyHint)
//   dismiss: read, and the three that act on what the job agent found

/** Who is calling: Claude through OAuth, or a named token. */
export type ConnectorAccess = { scope: "full" | TokenScope; name: string };

export const FULL_ACCESS: ConnectorAccess = { scope: "full", name: "Claude" };

/** The tools a "dismiss" token may use beyond the read-only ones. */
const DISMISS_TOOLS: ReadonlySet<string> = new Set(["dismiss_posting", "restore_posting", "record_vetting"]);

export function toolAllowed(access: ConnectorAccess, tool: { name: string; readOnly: boolean }): boolean {
  if (access.scope === "full") return true;
  if (tool.readOnly) return true;
  return access.scope === "dismiss" && DISMISS_TOOLS.has(tool.name);
}

/**
 * Makes `server` register only the tools `access` may use: one that isn't
 * allowed is taken out again at once, so it isn't listed, and a call to it
 * is an unknown tool, not a refusal that says it exists. Call it before the
 * first registerTool.
 */
export function limitTools(server: McpServer, access: ConnectorAccess): void {
  if (access.scope === "full") return;
  const register = server.registerTool.bind(server) as (...args: unknown[]) => { remove: () => void };
  (server as unknown as { registerTool: unknown }).registerTool = (name: string, config: { annotations?: { readOnlyHint?: boolean } }, handler: unknown) => {
    const tool = register(name, config, handler);
    if (!toolAllowed(access, { name, readOnly: config.annotations?.readOnlyHint === true })) tool.remove();
    return tool;
  };
}
