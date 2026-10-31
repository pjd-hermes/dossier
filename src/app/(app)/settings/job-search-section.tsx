"use client";

import { useId, useState } from "react";

import { ArbeitsagenturNote } from "@/components/arbeitsagentur-note";
import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { JOB_SOURCES, type JobSource, type JSearchHost } from "@/lib/job-search/search";
import { FREEHIRE_URL, JOB_KEY_UNREADABLE, JSEARCH_KEY_URLS, SOURCE_INFO, type JobKeyState, type JobSearchSettingsView } from "@/lib/job-search/sources";
import { cn } from "@/lib/cn";
import { usageLine } from "@/lib/job-search/usage";

import { saveJobSearchDetails, saveJobSourceKey } from "./actions";
import { setJobSourceOn, testJobSourceOf } from "./provider-actions";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; seconds: number }
  | { status: "failed"; message: string };

const UNTESTED: Connection = { status: "untested" };

/**
 * Settings → Job search (E14-4): a card per provider, each with its own
 * switch, key and test. Each field saves on its own; a key is saved when you
 * leave its field and never shown again. The Bundesagentur für Arbeit is
 * turned on only once its note is accepted, and isn't offered when the server
 * turns it off (#223).
 */
export function JobSearchSection({ initial }: { initial: JobSearchSettingsView }) {
  const track = useTrackSave();
  const [view, setView] = useState(initial);
  const [appId, setAppId] = useState(initial.adzuna.appId);
  const [connections, setConnections] = useState<Partial<Record<JobSource, Connection>>>({});
  // The Bundesagentur's switch is on, but its note isn't accepted yet, so nothing is saved.
  const [waitingForNote, setWaitingForNote] = useState(false);

  // Any change on a card means its last test no longer counts.
  const changed = (source: JobSource) => setConnections((current) => ({ ...current, [source]: UNTESTED }));

  const apply = (result: Awaited<ReturnType<typeof setJobSourceOn>>) => {
    if (result.ok) setView(result.data);
    return result.ok;
  };

  const isOn = (source: JobSource) => view.sourcesOn.includes(source) || (source === "ARBEITSAGENTUR" && waitingForNote);

  const turn = async (source: JobSource, on: boolean) => {
    changed(source);
    if (source === "ARBEITSAGENTUR" && on && !view.arbeitsagentur.acceptedAt) {
      setWaitingForNote(true);
      return;
    }
    if (source === "ARBEITSAGENTUR") setWaitingForNote(false);
    apply(toastResult(await track(setJobSourceOn({ source, on }))));
  };

  const acceptArbeitsagentur = async () => {
    const saved = apply(toastResult(await track(setJobSourceOn({ source: "ARBEITSAGENTUR", on: true, accepted: true }))));
    if (saved) setWaitingForNote(false);
    return saved;
  };

  const chooseHost = async (host: JSearchHost) => {
    setView((current) => ({ ...current, jsearch: { ...current.jsearch, host } }));
    changed("JSEARCH");
    apply(toastResult(await track(saveJobSearchDetails({ jsearchHost: host }))));
  };

  const saveAppId = async () => {
    if (appId.trim() === view.adzuna.appId) return;
    changed("ADZUNA");
    apply(toastResult(await track(saveJobSearchDetails({ adzunaAppId: appId }))));
  };

  const saveKey = async (keySource: "JSEARCH" | "ADZUNA", change: { action: "set"; value: string } | { action: "clear" }) => {
    changed(keySource);
    return apply(toastResult(await track(saveJobSourceKey({ source: keySource, change }))));
  };

  const test = async (source: JobSource) => {
    if (connections[source]?.status === "testing") return;
    const set = (connection: Connection) => setConnections((current) => ({ ...current, [source]: connection }));
    set({ status: "testing" });
    const result = await testJobSourceOf({ source });
    if (!result.ok) set({ status: "failed", message: result.error });
    else if (result.data.connected) set({ status: "connected", seconds: result.data.seconds });
    else set({ status: "failed", message: result.data.message });
  };

  const sources = view.arbeitsagentur.offered ? JOB_SOURCES : JOB_SOURCES.filter((source) => source !== "ARBEITSAGENTUR");

  return (
    <>
      <SettingsSectionIntro title="Job search">
        Where Find jobs and the job agent look for postings. Turn on as many providers as you like; each keeps its own key, and a key only ever goes to the provider it&apos;s for.
      </SettingsSectionIntro>

      {view.sourcesOn.length > 0 ? (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          Your searches (keywords, place and filters) go to each provider that&apos;s on. Nothing from your profile does.
        </p>
      ) : (
        <p role="note" className="rounded-card bg-surface px-4 py-3 text-meta text-muted">
          Find jobs and the job agent stay off until you turn a provider on.
        </p>
      )}

      {sources.map((source) => {
        const info = SOURCE_INFO[source];
        const on = isOn(source);
        const used = usageLine(source, view.usage[source] ?? 0);
        const accepted = Boolean(view.arbeitsagentur.acceptedAt);
        // The BA can't be tested, or searched, before its note is accepted.
        const testable = source !== "ARBEITSAGENTUR" || accepted;
        return (
          <Card key={source} role="group" aria-label={info.name} className="flex flex-col gap-5">
            <Toggle
              label={<span className="text-[15px] font-medium">{info.name}</span>}
              description={
                <span className="flex flex-col gap-1.5">
                  <span>
                    {info.description}
                    {source === "ARBEITSAGENTUR" && " Find jobs only: the job agent never searches it."}
                  </span>
                  <span className="text-xs">{info.tag}</span>
                </span>
              }
              aria-label={`Use ${info.name}`}
              checked={on}
              onCheckedChange={(checked) => void turn(source, checked)}
            />

            {on && (
              <>
                {source === "JSEARCH" && (
                  <>
                    <HostChoice host={view.jsearch.host} onChange={(host) => void chooseHost(host)} />
                    <KeyField
                      label="API key"
                      keyState={view.jsearch.keyState}
                      envName="DOSSIER_JSEARCH_KEY"
                      getKey={{ href: JSEARCH_KEY_URLS[view.jsearch.host], text: view.jsearch.host === "rapidapi" ? "JSearch on RapidAPI" : "OpenWeb Ninja" }}
                      onSave={(change) => saveKey("JSEARCH", change)}
                    />
                  </>
                )}
                {source === "ADZUNA" && (
                  <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
                    <Input
                      label="App ID"
                      value={appId}
                      spellCheck={false}
                      autoComplete="off"
                      inputClassName="font-mono text-[13.5px]"
                      onChange={(event) => setAppId(event.target.value)}
                      onBlur={() => void saveAppId()}
                    />
                    <KeyField
                      label="App key"
                      keyState={view.adzuna.keyState}
                      envName="DOSSIER_ADZUNA_KEY"
                      getKey={{ href: SOURCE_INFO.ADZUNA.keyUrl!, text: "Adzuna's developer site" }}
                      onSave={(change) => saveKey("ADZUNA", change)}
                    />
                  </div>
                )}
                {source === "ARBEITSAGENTUR" && (
                  <>
                    <ArbeitsagenturNote accepted={accepted} onAccept={acceptArbeitsagentur} />
                    <p className="text-sm text-muted">No key needed.</p>
                  </>
                )}
                {source === "FREEHIRE" && (
                  <p className="text-sm text-muted">
                    {view.freehire.host === new URL(FREEHIRE_URL).host
                      ? `No key needed. Dossier searches FreeHire's public catalogue at ${view.freehire.host}.`
                      : `No key needed. Dossier searches your own FreeHire at ${view.freehire.host}.`}
                  </p>
                )}

                {testable && (
                  <div className="flex flex-wrap items-center gap-3.5 pt-1">
                    <Button variant="secondary" onClick={() => void test(source)} disabled={connections[source]?.status === "testing"}>
                      {connections[source]?.status === "testing" ? "Testing…" : "Test connection"}
                    </Button>
                    <ConnectionStatus connection={connections[source] ?? UNTESTED} source={source} />
                  </div>
                )}
                {used && <p className="text-meta text-muted">{used}</p>}
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}

function HostChoice({ host, onChange }: { host: JSearchHost; onChange: (host: JSearchHost) => void }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-[7px]">
      <span id={labelId} className="text-label text-muted">
        Key from
      </span>
      <SegmentedControl<JSearchHost>
        aria-labelledby={labelId}
        size="sm"
        options={[
          { value: "openwebninja", label: "OpenWeb Ninja" },
          { value: "rapidapi", label: "RapidAPI" },
        ]}
        value={host}
        onValueChange={onChange}
      />
    </div>
  );
}

/** A write-only key: saved when you leave the field or press Enter, then only "Saved" shows. */
function KeyField({
  label,
  keyState,
  envName,
  getKey,
  onSave,
}: {
  label: string;
  keyState: JobKeyState;
  envName: string;
  getKey: { href: string; text: string };
  onSave: (change: { action: "set"; value: string } | { action: "clear" }) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const save = async () => {
    if (!value.trim()) return;
    if (await onSave({ action: "set", value })) setValue("");
  };
  return (
    <div className="flex flex-col gap-2.5">
      <Input
        label={label}
        type="password"
        autoComplete="off"
        value={value}
        placeholder={
          keyState === "set" ? "Saved · type a new key to replace it" : keyState === "env" ? `Using ${envName} · type one to save it here` : "Stored encrypted on your server"
        }
        error={keyState === "unreadable" ? JOB_KEY_UNREADABLE : undefined}
        hint={
          keyState === "none" ? (
            <>
              Get one from{" "}
              <a href={getKey.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                {getKey.text}
              </a>
              .
            </>
          ) : undefined
        }
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim()) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {(keyState === "set" || keyState === "unreadable") && (
        <Button variant="text" size="sm" className="self-start" onClick={() => void onSave({ action: "clear" })}>
          Remove saved key
        </Button>
      )}
    </div>
  );
}

function ConnectionStatus({ connection, source }: { connection: Connection; source: JobSource }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${SOURCE_INFO[source].name} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", "Sending a small search…"]
          : ["bg-faint", "text-muted", source === "JSEARCH" ? "Not tested since your last change · a test uses one search from your plan" : "Not tested since your last change"];
  return (
    <p role="status" className={cn("flex items-center gap-2 text-control", text)}>
      <span aria-hidden className={cn("size-2 flex-none rounded-full", dot)} />
      {message}
    </p>
  );
}
