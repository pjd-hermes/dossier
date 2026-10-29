"use client";

import { Switch } from "radix-ui";
import { useMemo, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { MAX_AGENT_SEARCHES, type AgentSearch } from "@/lib/agent/search-schema";
import { useAutosave } from "@/hooks/use-autosave";
import type { Country } from "@/lib/job-search/countries";
import type { JobSource } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";

import { addAgentSearch, removeAgentSearch, updateAgentSearch } from "../agent/search-actions";
import { RemoteOnlyField, SearchFields } from "../jobs/search-fields";
import { joinWithAnd } from "./source-caps";

/** "Product designer · Rotterdam · Netherlands · paused" */
function summary(search: AgentSearch, countries: readonly Country[]): string {
  const country = countries.find((option) => option.code === search.country)?.name;
  const parts = [search.keywords, search.place, country, search.remoteOnly ? "remote only" : "", search.enabled ? "" : "paused"].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nothing filled in yet";
}

function RunSwitch({ search, onChange }: { search: AgentSearch; onChange: (on: boolean) => void }) {
  return (
    <Switch.Root
      aria-label={`Run ${search.name}`}
      checked={search.enabled}
      onCheckedChange={onChange}
      className="flex h-6 w-10 shrink-0 items-center rounded-full bg-toggle-off p-[3px] data-[state=checked]:bg-primary motion-safe:transition-colors"
    >
      <Switch.Thumb className="block size-[18px] rounded-full bg-white shadow-knob data-[state=checked]:translate-x-4 motion-safe:transition-transform" />
    </Switch.Root>
  );
}

/**
 * Settings → Job agent → Saved searches: up to five, one open for editing at
 * a time. The fields save once typing pauses; pausing a search saves at once.
 */
export function SavedSearches({
  initial,
  sources,
  countries,
  onChange,
}: {
  initial: AgentSearch[];
  /** The providers the agent searches. */
  sources: readonly JobSource[];
  countries: readonly Country[];
  /** Told the list after each change, for the preview of the next run. */
  onChange?: (searches: AgentSearch[]) => void;
}) {
  const track = useTrackSave();
  const [searches, setSearches] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AgentSearch | null>(null);

  const update = (next: AgentSearch[]) => {
    setSearches(next);
    onChange?.(next);
  };
  const patch = (id: string, changes: Partial<AgentSearch>) => update(searches.map((search) => (search.id === id ? { ...search, ...changes } : search)));

  const add = async () => {
    const result = toastResult(await track(addAgentSearch({})));
    if (!result.ok) return;
    update([...searches, result.data]);
    setOpenId(result.data.id);
  };

  const run = async (search: AgentSearch, enabled: boolean) => {
    patch(search.id, { enabled });
    const result = toastResult(await track(updateAgentSearch({ id: search.id, changes: { enabled } })));
    if (!result.ok) patch(search.id, { enabled: !enabled });
  };

  const remove = async (search: AgentSearch) => {
    const result = toastResult(await track(removeAgentSearch({ id: search.id })));
    if (!result.ok) return;
    update(searches.filter((other) => other.id !== search.id));
    if (openId === search.id) setOpenId(null);
  };

  const providers = sources.length > 0 ? joinWithAnd(sources.map((source) => SOURCE_INFO[source].name)) : "the providers you turn on";

  return (
    <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-field font-medium">Saved searches</h3>
          <p className="text-meta text-muted">
            One per job type. Each runs on {providers}. Postings you saved, dismissed or applied for are left out.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-meta text-muted">
            {searches.length} of {MAX_AGENT_SEARCHES}
          </span>
          <Button variant="secondary" size="sm" disabled={searches.length >= MAX_AGENT_SEARCHES} onClick={() => void add()}>
            Add a search
          </Button>
        </div>
      </div>

      {searches.length === 0 && <p className="text-meta text-muted">No saved searches yet. Add one to give the agent something to look for.</p>}

      <ul className="flex flex-col gap-3">
        {searches.map((search) => (
          <li key={search.id} className="rounded-card border border-line-field px-4 py-3">
            {search.id === openId ? (
              <SearchEditor
                key={search.id}
                search={search}
                countries={countries}
                onEdit={(changes) => patch(search.id, changes)}
                onRun={(on) => void run(search, on)}
                onRemove={() => setRemoving(search)}
                onClose={() => setOpenId(null)}
              />
            ) : (
              <div className="flex items-center gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-field font-medium">{search.name}</span>
                  <span className="truncate text-meta text-muted">{summary(search, countries)}</span>
                </div>
                <RunSwitch search={search} onChange={(on) => void run(search, on)} />
                <Button variant="secondary" size="sm" aria-label={`Edit ${search.name}`} onClick={() => setOpenId(search.id)}>
                  Edit
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this search?"
        description="The agent stops running it. Postings it found stay on the Agent screen."
        confirmLabel="Remove search"
        onConfirm={() => removing && void remove(removing)}
      />
    </Card>
  );
}

function SearchEditor({
  search,
  countries,
  onEdit,
  onRun,
  onRemove,
  onClose,
}: {
  search: AgentSearch;
  countries: readonly Country[];
  onEdit: (changes: Partial<AgentSearch>) => void;
  onRun: (on: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const track = useTrackSave();
  const { name, keywords, place, country, radiusKm, remoteOnly, postedWithin } = search;
  // Not `enabled`, which saves at once, so a switch never restarts the typing timer.
  const fields = useMemo(() => ({ name, keywords, place, country, radiusKm, remoteOnly, postedWithin }), [name, keywords, place, country, radiusKm, remoteOnly, postedWithin]);
  const { flush } = useAutosave(fields, ({ name: draftName, ...rest }) =>
    // A blank name waits for one; the rest is saved.
    track(updateAgentSearch({ id: search.id, changes: draftName.trim() ? { name: draftName, ...rest } : rest })),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2" onBlur={flush}>
        <Input label="Name" className="sm:col-span-2" value={search.name} onChange={(event) => onEdit({ name: event.target.value })} />
        <SearchFields value={search} onChange={onEdit} source={null} countries={countries} />
        <div className="sm:col-span-2">
          <RemoteOnlyField value={search} onChange={onEdit} source={null} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <RunSwitch search={search} onChange={onRun} />
          <span className="text-meta text-muted">{search.enabled ? "Runs every day" : "Paused"}</span>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="danger-text" size="sm" onClick={onRemove}>
            Remove
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
