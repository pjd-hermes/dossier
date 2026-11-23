import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse } from "@playwright/test";

import { resetData, sql } from "./support";

// The fork's access tokens (Settings → MCP connector → Access tokens): an app
// that can't sign in through OAuth, such as n8n, gets a token, uses the tools
// its scope allows at /api/mcp, and is refused once the token is revoked.

test.beforeAll(resetData);
// Other specs see the connector off.
test.afterAll(() => sql(`DELETE FROM "Setting" WHERE key IN ('connectorEnabledAt', 'connectorTokens', 'connectorTokenUse')`));

async function rpc(response: APIResponse): Promise<{ result: { tools?: { name: string }[] } }> {
  const body = await response.text();
  return JSON.parse(body.trimStart().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))!.slice(6));
}

test("makes a token, serves its tools by scope, and refuses it once revoked", async ({ page, baseURL, playwright }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const app = await playwright.request.newContext({ baseURL });
  const toolsOf = async (token: string) => (await app.post("/api/mcp", { headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } }));

  await page.goto("/settings?section=connector");
  await expect(page.getByRole("heading", { name: "Access tokens" })).toHaveCount(0);
  await page.getByRole("switch", { name: "Let apps connect" }).click();
  await expect(page.getByRole("heading", { name: "Access tokens" })).toBeVisible();

  // A read-only token.
  await page.getByLabel("Name", { exact: true }).fill("reports");
  await page.getByRole("button", { name: "Create token" }).click();
  const readToken = (await page.getByRole("note", { name: "New token" }).locator("code").textContent())!.trim();
  expect(readToken).toMatch(/^dsr_/);
  const readTools = (await rpc(await toolsOf(readToken))).result.tools!.map((tool) => tool.name);
  expect(readTools).toContain("list_agent_finds");
  expect(readTools).not.toContain("dismiss_posting");
  expect(readTools).not.toContain("save_application");

  // One that may dismiss.
  await page.getByLabel("Name", { exact: true }).fill("n8n");
  await page.getByRole("radio", { name: "Read and dismiss" }).click();
  await page.getByRole("button", { name: "Create token" }).click();
  // The note shows the first token until the second is made.
  await expect(page.getByRole("note", { name: "New token" }).locator("code")).not.toHaveText(readToken);
  const dismissToken = (await page.getByRole("note", { name: "New token" }).locator("code").textContent())!.trim();
  const dismissTools = (await rpc(await toolsOf(dismissToken))).result.tools!.map((tool) => tool.name);
  expect(dismissTools).toEqual(expect.arrayContaining(["list_agent_finds", "company_history", "record_vetting", "dismiss_posting", "restore_posting"]));
  expect(dismissTools).not.toContain("save_application");

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);

  // Only the hashes are kept, and the token is gone from the page after a reload.
  const stored = (await sql(`SELECT value FROM "Setting" WHERE key = 'connectorTokens'`)) as unknown;
  expect(JSON.stringify(stored)).not.toContain(dismissToken);
  await page.reload();
  await expect(page.getByRole("note", { name: "New token" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Access tokens" })).toContainText("n8n");

  // Revoked, it's refused from the next request; the other still works.
  await page.getByRole("button", { name: "Revoke n8n" }).click();
  await expect(page.getByRole("list", { name: "Access tokens" })).not.toContainText("n8n");
  expect((await toolsOf(dismissToken)).status()).toBe(401);
  expect((await toolsOf(readToken)).status()).toBe(200);
});
