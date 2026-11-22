"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { copyText } from "@/lib/copy-text";
import type { TokenInfo, TokenScope } from "@/lib/connector/tokens";

import { createConnectorToken, revokeConnectorToken } from "./connector-token-actions";

const SCOPES: { value: TokenScope; label: string }[] = [
  { value: "read", label: "Read only" },
  { value: "dismiss", label: "Read and dismiss" },
];
const scopeLabel = (scope: TokenScope) => SCOPES.find((option) => option.value === scope)!.label;

/**
 * Fork: named access tokens for apps that can't sign in through OAuth, such
 * as n8n (src/lib/connector/tokens.ts). A token is shown once, when it's
 * made; only its hash is kept. "Read only" can look at the profile,
 * applications and what the job agent found; "Read and dismiss" can also
 * record a verdict on a posting and dismiss it.
 */
export function ConnectorTokens({ initial }: { initial: TokenInfo[] }) {
  const track = useTrackSave();
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TokenScope>("read");
  const [fresh, setFresh] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    const result = toastResult(await track(createConnectorToken({ name, scope })));
    if (!result.ok) return;
    setTokens(result.data.tokens);
    setFresh(result.data.token);
    setName("");
  };

  const revoke = async (id: string) => {
    const result = toastResult(await track(revokeConnectorToken({ id })));
    if (result.ok) setTokens(result.data.tokens);
  };

  const copy = async (token: string) => toast((await copyText(token)) ? "Token copied." : "Couldn't copy it. Select the token and copy it instead.");

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-control font-medium">Access tokens</h3>
        <p className="text-sm text-pretty text-muted">
          For an app that can&apos;t sign in through OAuth, such as n8n: add the token to its MCP client as a header,{" "}
          <code className="font-mono text-label">Authorization: Bearer &lt;token&gt;</code>. <strong>Read only</strong> can look at your profile, applications and
          what the job agent found. <strong>Read and dismiss</strong> can also record whether a posting looks real and dismiss one. Neither can write
          applications or run searches. Revoke a token when you stop using it: Disconnect all apps doesn&apos;t, since that&apos;s for apps signed in through OAuth.
        </p>
      </div>

      {fresh && (
        <div role="note" className="flex flex-col gap-2 rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          <p>Copy this token now. It won&apos;t be shown again.</p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere]">{fresh}</code>
            <Button variant="secondary" size="sm" onClick={() => void copy(fresh)}>
              Copy token
            </Button>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <ul aria-label="Access tokens" className="flex flex-col gap-2">
          {tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 text-sm">
                <strong className="font-medium">{token.name}</strong> · {scopeLabel(token.scope)} · made {token.createdAt.slice(0, 10)} ·{" "}
                {token.lastUsedAt ? `last used ${token.lastUsedAt.slice(0, 10)}` : "Never used"}
              </span>
              <Button variant="text" size="sm" onClick={() => void revoke(token.id)}>
                Revoke <span className="sr-only">{token.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Name"
          className="min-w-0 flex-1"
          placeholder="n8n"
          autoComplete="off"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void create();
            }
          }}
        />
        <SegmentedControl aria-label="What the token may do" options={SCOPES} value={scope} onValueChange={setScope} />
        <Button variant="secondary" onClick={() => void create()}>
          Create token
        </Button>
      </div>
    </Card>
  );
}
