import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { copyText } from "@/lib/copy-text";

import { createConnectorToken, revokeConnectorToken } from "./connector-token-actions";
import { ConnectorTokens } from "./connector-tokens";

vi.mock("./connector-token-actions", () => ({
  createConnectorToken: vi.fn(async ({ name, scope }: { name: string; scope: "read" | "dismiss" | "draft" }) => ({
    ok: true,
    data: { token: "dsr_secret-token-text", tokens: [{ id: "t1", name, scope, createdAt: "2026-11-22T12:00:00.000Z", lastUsedAt: null }] },
  })),
  revokeConnectorToken: vi.fn(async () => ({ ok: true, data: { tokens: [] } })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));

beforeEach(() => vi.clearAllMocks());

describe("Settings → MCP connector → Access tokens (fork)", () => {
  it("makes a token with a name and a scope, and shows its text once, with a way to copy it", async () => {
    const user = userEvent.setup();
    render(<ConnectorTokens initial={[]} />);
    expect(screen.getByRole("heading", { name: "Access tokens" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "n8n");
    await user.click(screen.getByRole("radio", { name: "Read and dismiss" }));
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(createConnectorToken).toHaveBeenCalledWith({ name: "n8n", scope: "dismiss" });

    const note = screen.getByRole("note", { name: "New token" });
    expect(note).toHaveTextContent("dsr_secret-token-text");
    expect(note).toHaveTextContent("won't be shown again");
    await user.click(within(note).getByRole("button", { name: "Copy token" }));
    expect(copyText).toHaveBeenCalledWith("dsr_secret-token-text");
    expect(toast).toHaveBeenCalledWith("Token copied.");
    expect(screen.getByRole("list", { name: "Access tokens" })).toHaveTextContent("n8n");
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("offers a scope that can also draft, and says what it adds", async () => {
    const user = userEvent.setup();
    render(<ConnectorTokens initial={[]} />);
    await user.type(screen.getByLabelText("Name"), "n8n");
    await user.click(screen.getByRole("radio", { name: "Read, dismiss and draft" }));
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(createConnectorToken).toHaveBeenCalledWith({ name: "n8n", scope: "draft" });
    expect(screen.getByText(/can also have Dossier's own AI model draft an application/)).toBeInTheDocument();
  });

  it("makes a read-only token unless the other scope is chosen", async () => {
    const user = userEvent.setup();
    render(<ConnectorTokens initial={[]} />);
    await user.type(screen.getByLabelText("Name"), "report{Enter}");
    expect(createConnectorToken).toHaveBeenCalledWith({ name: "report", scope: "read" });
  });

  it("lists each token with its scope and last use, never its text, and revokes one", async () => {
    const user = userEvent.setup();
    render(
      <ConnectorTokens
        initial={[
          { id: "t1", name: "n8n", scope: "dismiss", createdAt: "2026-11-20T09:00:00.000Z", lastUsedAt: "2026-11-22T08:30:00.000Z" },
          { id: "t2", name: "reports", scope: "read", createdAt: "2026-11-21T09:00:00.000Z", lastUsedAt: null },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Access tokens" });
    expect(list).toHaveTextContent("n8n");
    expect(list).toHaveTextContent("Read and dismiss");
    expect(list).toHaveTextContent("2026-11-22");
    expect(list).toHaveTextContent("Never used");
    expect(screen.queryByRole("note", { name: "New token" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revoke n8n" }));
    expect(revokeConnectorToken).toHaveBeenCalledWith({ id: "t1" });
    expect(screen.queryByRole("list", { name: "Access tokens" })).not.toBeInTheDocument();
  });

  it("keeps what was typed and shows no token when making one fails", async () => {
    const user = userEvent.setup();
    vi.mocked(createConnectorToken).mockResolvedValueOnce({ ok: false, error: "There's a token with that name already." });
    render(<ConnectorTokens initial={[]} />);
    await user.type(screen.getByLabelText("Name"), "n8n{Enter}");
    expect(screen.getByLabelText("Name")).toHaveValue("n8n");
    expect(screen.queryByRole("note", { name: "New token" })).not.toBeInTheDocument();
  });
});
