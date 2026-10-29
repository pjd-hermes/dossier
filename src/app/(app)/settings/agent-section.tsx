"use client";

import Link from "next/link";
import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import type { AgentSearch, SourceCaps as Caps } from "@/lib/agent/search-schema";
import type { Country } from "@/lib/job-search/countries";
import type { JobSource } from "@/lib/job-search/search";
import type { AgentRun } from "@/lib/settings";

import { saveAgentSettings } from "../agent/actions";
import { SavedSearches } from "./saved-searches";
import { SettingsSectionIntro } from "./settings-screen";
import { SourceCaps } from "./source-caps";

export type AgentSettings = {
  enabled: boolean;
  searches: AgentSearch[];
  caps: Caps;
  hour: number;
  minScore: number;
  maxScores: number;
  maxDrafts: number;
  autoDraft: boolean;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MIN_SCORES = [50, 55, 60, 65, 70, 75, 80, 85, 90];
const SCORE_COUNTS = Array.from({ length: 30 }, (_, index) => index + 1);
const DRAFT_COUNTS = Array.from({ length: 11 }, (_, index) => index);
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Settings → Job agent (E16-7): whether it runs, the saved searches it runs,
 * how many each provider gets, when, and how much a run may do. Each change
 * saves at once; a search's fields once typing pauses.
 */
export function AgentSection({
  initial,
  sources,
  runs,
  aiReady,
  countries,
  timeZone,
}: {
  initial: AgentSettings;
  /** The providers on in Settings → Job search that the agent may search. */
  sources: readonly JobSource[];
  /** Newest first, for the preview of the next run. */
  runs: readonly AgentRun[];
  aiReady: boolean;
  countries: readonly Country[];
  /** The user's time zone, which the hour is in. */
  timeZone: string;
}) {
  const track = useTrackSave();
  const [settings, setSettings] = useState(initial);
  const [searches, setSearches] = useState(initial.searches);

  const change = (next: Partial<AgentSettings>) => {
    const previous = settings;
    setSettings({ ...settings, ...next });
    void track(saveAgentSettings(next)).then((result) => {
      if (!toastResult(result).ok) setSettings(previous);
    });
  };

  const turnOn = (on: boolean) => change({ enabled: on });

  return (
    <>
      <SettingsSectionIntro title="Job agent">
        Once a day it runs each of your saved searches on every provider that&apos;s on, scores the new postings against your profile, and keeps the best on the Agent screen. It never sends or applies.
      </SettingsSectionIntro>

      {(sources.length === 0 || !aiReady) && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          {sources.length === 0 ? "The agent searches the providers you turn on in " : "The agent scores postings with the AI provider in "}
          <Link href={sources.length === 0 ? "/settings?section=jobs" : "/settings?section=ai"} className="font-medium text-warning underline underline-offset-2">
            {sources.length === 0 ? "Settings → Job search" : "Settings → AI provider"}
          </Link>
          {sources.length === 0 ? ", and none is on yet." : ", which isn't set up yet. Choose one first."}
        </p>
      )}

      <Card padding="none" className="px-7 py-4">
        <Toggle
          label="Run the job agent"
          description={
            settings.enabled
              ? `On. It runs once a day after ${clock(settings.hour)} your time (${timeZone}), and you can run it now and then on the Agent screen.`
              : "Off. Nothing is searched or scored until it's on."
          }
          checked={settings.enabled}
          onCheckedChange={turnOn}
        />
      </Card>

      <SavedSearches initial={initial.searches} sources={sources} countries={countries} onChange={setSearches} />

      <SourceCaps initial={initial.caps} sources={sources} searches={searches} runs={runs} />

      <Card padding="none" className="grid gap-x-[18px] gap-y-5 px-7 py-[26px] sm:grid-cols-2">
        <Select label="Runs after" hint={`Your time (${timeZone})`} value={String(settings.hour)} onChange={(event) => change({ hour: Number(event.target.value) })}>
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {clock(hour)}
            </option>
          ))}
        </Select>
        <Select
          label="Minimum score"
          hint="Postings scored lower stay out of the queue."
          value={String(settings.minScore)}
          onChange={(event) => change({ minScore: Number(event.target.value) })}
        >
          {[...new Set([...MIN_SCORES, settings.minScore])].sort((a, b) => a - b).map((score) => (
            <option key={score} value={score}>
              {score} of 100
            </option>
          ))}
        </Select>
        <Select label="Postings scored per run" value={String(settings.maxScores)} onChange={(event) => change({ maxScores: Number(event.target.value) })}>
          {SCORE_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Select
          label="Drafts per run, at most"
          value={String(settings.maxDrafts)}
          disabled={!settings.autoDraft}
          hint={settings.autoDraft ? undefined : "Turn on Prepare drafts on its own first"}
          onChange={(event) => change({ maxDrafts: Number(event.target.value) })}
        >
          {DRAFT_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Toggle
          className="sm:col-span-2"
          label="Prepare drafts on its own"
          description={
            settings.autoDraft
              ? `For the best new postings of each run, up to ${plural(settings.maxDrafts, "draft", "drafts")}: a tailored resume and cover letter, waiting for your review.`
              : "Off. You choose which postings get a draft with Prepare draft."
          }
          checked={settings.autoDraft}
          onCheckedChange={(autoDraft) => change({ autoDraft })}
        />
      </Card>

      <p className="text-meta text-muted">
        One run a day, and at most three in any 24 hours. Each run scores up to {plural(settings.maxScores, "posting", "postings")}
        {settings.autoDraft ? ` and prepares up to ${plural(settings.maxDrafts, "draft", "drafts")}` : ""}. Scoring and drafts go to your AI provider with your profile, as a new application does; job providers only get the searches.
      </p>
    </>
  );
}
