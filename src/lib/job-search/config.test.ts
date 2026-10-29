import { describe, expect, it, vi } from "vitest";

import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";

import { arbeitsagenturStartupNotice, credentialsFor, jobSearchView, requestContext, resolveJobSearchConfig } from "./config";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const nothingSaved = {
  jobSource: null,
  jobSourcesOn: null,
  jsearchKeyEnc: null,
  jsearchHost: "openwebninja" as const,
  adzunaAppId: null,
  adzunaKeyEnc: null,
  arbeitsagenturAcceptedAt: null,
};
const ACCEPTED = "2026-10-23T09:00:00.000Z";
const noEnv = {};

describe("resolveJobSearchConfig", () => {
  it("is off until a source is chosen", () => {
    const config = resolveJobSearchConfig(nothingSaved, noEnv);
    expect(config).toMatchObject({ source: null, saved: false, jsearch: { key: null, keyState: "none" }, adzuna: { appId: "", key: null } });
    expect(jobSearchView(config)).toEqual({
      source: "OFF",
      sourcesOn: [],
      jsearch: { host: "openwebninja", keyState: "none" },
      adzuna: { appId: "", keyState: "none" },
      arbeitsagentur: { offered: true, acceptedAt: null },
      freehire: { host: "freehire.me" },
      usage: {},
    });
  });

  it("uses the environment until something is saved", () => {
    const config = resolveJobSearchConfig(nothingSaved, {
      DOSSIER_JOBS_SOURCE: "jsearch",
      DOSSIER_JSEARCH_KEY: "ak_env",
      DOSSIER_JSEARCH_HOST: "rapidapi",
      DOSSIER_ADZUNA_APP_ID: "app-env",
      DOSSIER_ADZUNA_KEY: "adz-env",
    });
    expect(config).toMatchObject({
      source: "JSEARCH",
      saved: false,
      jsearch: { key: "ak_env", host: "rapidapi", keyState: "env" },
      adzuna: { appId: "app-env", key: "adz-env", keyState: "env" },
    });
    expect(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "off" }).source).toBeNull();
  });

  it("prefers what's saved, Off included, and decrypts saved keys", () => {
    const saved = {
      jobSource: "ADZUNA" as const,
      jobSourcesOn: null,
      jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_saved"),
      jsearchHost: "openwebninja" as const,
      adzunaAppId: "app-saved",
      adzunaKeyEnc: encryptSecret(JOB_SOURCE_KEY, "adz-saved"),
      arbeitsagenturAcceptedAt: null,
    };
    const config = resolveJobSearchConfig(saved, { DOSSIER_JOBS_SOURCE: "jsearch", DOSSIER_JSEARCH_KEY: "ak_env", DOSSIER_JSEARCH_HOST: "rapidapi" });
    expect(config).toMatchObject({
      source: "ADZUNA",
      saved: true,
      jsearch: { key: "ak_saved", host: "openwebninja", keyState: "set" },
      adzuna: { appId: "app-saved", key: "adz-saved", keyState: "set" },
    });
    expect(resolveJobSearchConfig({ ...saved, jobSource: "OFF" }, { DOSSIER_JOBS_SOURCE: "jsearch" })).toMatchObject({ source: null, saved: true });
  });

  it("says when a saved key can't be read, rather than using another", () => {
    const config = resolveJobSearchConfig(
      { ...nothingSaved, jobSource: "JSEARCH", jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak", "b".repeat(32)) },
      { DOSSIER_JSEARCH_KEY: "ak_env" },
    );
    expect(config.jsearch).toEqual({ key: null, host: "openwebninja", keyState: "unreadable" });
    expect(() => credentialsFor(config, "JSEARCH")).toThrow("Your saved JSearch key can't be read. Enter it again in Settings → Job search.");
  });
});

describe("credentialsFor", () => {
  const config = resolveJobSearchConfig(
    { ...nothingSaved, jobSource: "JSEARCH", jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_saved"), jsearchHost: "rapidapi" },
    noEnv,
  );

  it("gives each source its own key", () => {
    expect(credentialsFor(config, "JSEARCH")).toEqual({ key: "ak_saved", host: "rapidapi" });
    expect(credentialsFor({ ...config, arbeitsagentur: { offered: true, acceptedAt: ACCEPTED } }, "ARBEITSAGENTUR")).toEqual({});
    expect(credentialsFor(config, "FREEHIRE")).toEqual({});
  });

  it("says what's missing", () => {
    expect(() => credentialsFor(config, "ADZUNA")).toThrow("Add your Adzuna app ID and key in Settings → Job search first.");
    expect(() => credentialsFor(resolveJobSearchConfig(nothingSaved, noEnv), "JSEARCH")).toThrow("Add your JSearch key in Settings → Job search first.");
    const keyOnly = resolveJobSearchConfig({ ...nothingSaved, adzunaKeyEnc: encryptSecret(JOB_SOURCE_KEY, "adz") }, noEnv);
    expect(() => credentialsFor(keyOnly, "ADZUNA")).toThrow(/app ID and key/);
  });
});

describe("the Bundesagentur für Arbeit (#223)", () => {
  const chosen = { ...nothingSaved, jobSource: "ARBEITSAGENTUR" as const };

  it("isn't searched until its note is accepted", () => {
    const waiting = resolveJobSearchConfig(chosen, noEnv);
    expect(waiting).toMatchObject({ source: "ARBEITSAGENTUR", arbeitsagentur: { offered: true, acceptedAt: null } });
    expect(() => credentialsFor(waiting, "ARBEITSAGENTUR")).toThrow(
      expect.objectContaining({ problem: "not-accepted", message: "Read the note about Bundesagentur für Arbeit and tick “I understand” before Dossier searches it." }),
    );
    const accepted = resolveJobSearchConfig({ ...chosen, arbeitsagenturAcceptedAt: ACCEPTED }, noEnv);
    expect(credentialsFor(accepted, "ARBEITSAGENTUR")).toEqual({});
  });

  it("is off everywhere when the server turns it off, a saved choice included", () => {
    const off = resolveJobSearchConfig({ ...chosen, arbeitsagenturAcceptedAt: ACCEPTED }, { DOSSIER_JOBS_ARBEITSAGENTUR: "off" });
    expect(off).toMatchObject({ source: null, saved: true, arbeitsagentur: { offered: false } });
    expect(jobSearchView(off)).toMatchObject({ source: "OFF", arbeitsagentur: { offered: false, acceptedAt: ACCEPTED } });
    // A saved BA posting doesn't fetch its text either.
    expect(() => credentialsFor(off, "ARBEITSAGENTUR")).toThrow(expect.objectContaining({ problem: "off" }));
    // Other sources aren't touched.
    expect(resolveJobSearchConfig({ ...chosen, jobSource: "JSEARCH" }, { DOSSIER_JOBS_ARBEITSAGENTUR: "off" }).source).toBe("JSEARCH");
  });

  it("logs its note at start when DOSSIER_JOBS_SOURCE chooses it", () => {
    const fromEnv = resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "arbeitsagentur" });
    expect(arbeitsagenturStartupNotice(fromEnv)).toMatch(
      /^Job search: DOSSIER_JOBS_SOURCE chooses the Bundesagentur für Arbeit\. The Bundesagentur für Arbeit has no official API\..* It isn't searched until you tick “I understand” in Settings → Job search\.$/,
    );
    const acceptedFromEnv = resolveJobSearchConfig({ ...nothingSaved, arbeitsagenturAcceptedAt: ACCEPTED }, { DOSSIER_JOBS_SOURCE: "arbeitsagentur" });
    expect(arbeitsagenturStartupNotice(acceptedFromEnv)).not.toMatch(/isn't searched/);
    // Chosen in Settings, or another source: nothing to log.
    expect(arbeitsagenturStartupNotice(resolveJobSearchConfig(chosen, noEnv))).toBeNull();
    expect(arbeitsagenturStartupNotice(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "jsearch" }))).toBeNull();
  });
});

describe("requestContext", () => {
  it("leaves sources at their own address, unless the end-to-end tests point them at a fake", () => {
    expect(requestContext("JSEARCH", undefined)).toEqual({});
    expect(requestContext("ADZUNA", "http://127.0.0.1:3998/")).toEqual({ baseUrl: "http://127.0.0.1:3998/adzuna" });
    expect(requestContext("FREEHIRE", undefined, "https://jobs.example")).toEqual({ baseUrl: "https://jobs.example" });
    expect(requestContext("FREEHIRE", "http://127.0.0.1:3998/", "https://jobs.example")).toEqual({
      baseUrl: "http://127.0.0.1:3998/freehire",
    });
  });
});

describe("FreeHire from the environment", () => {
  it("chooses FreeHire when DOSSIER_JOBS_SOURCE says so", () => {
    expect(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "freehire" }).source).toBe("FREEHIRE");
  });

  it("searches freehire.me, or the self-hosted FreeHire DOSSIER_FREEHIRE_URL names", () => {
    expect(resolveJobSearchConfig(nothingSaved, noEnv).freehire).toEqual({ url: "https://freehire.me" });
    const own = resolveJobSearchConfig(nothingSaved, { DOSSIER_FREEHIRE_URL: "https://jobs.example:8443" });
    expect(own.freehire).toEqual({ url: "https://jobs.example:8443" });
    expect(jobSearchView(own).freehire).toEqual({ host: "jobs.example:8443" });
  });
});

describe("sourcesOn", () => {
  it("is the one chosen source while nothing else is saved", () => {
    expect(resolveJobSearchConfig({ ...nothingSaved, jobSource: "JSEARCH" }, noEnv)).toMatchObject({ sourcesOn: ["JSEARCH"], source: "JSEARCH" });
  });

  it("follows DOSSIER_JOBS_SOURCE when nothing is saved", () => {
    expect(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "adzuna" }).sourcesOn).toEqual(["ADZUNA"]);
  });

  it("is empty while job search is off", () => {
    expect(resolveJobSearchConfig({ ...nothingSaved, jobSource: "OFF" }, noEnv)).toMatchObject({ sourcesOn: [], source: null });
  });

  it("keeps the saved list in provider order, without duplicates, and falls back from a provider that is off", () => {
    const config = resolveJobSearchConfig({ ...nothingSaved, jobSource: "ADZUNA", jobSourcesOn: ["FREEHIRE", "JSEARCH", "JSEARCH"] }, noEnv);
    expect(config).toMatchObject({ sourcesOn: ["JSEARCH", "FREEHIRE"], source: "JSEARCH" });
  });

  it("keeps Find jobs' provider when it is on", () => {
    expect(resolveJobSearchConfig({ ...nothingSaved, jobSource: "FREEHIRE", jobSourcesOn: ["JSEARCH", "FREEHIRE"] }, noEnv).source).toBe("FREEHIRE");
  });

  it("leaves out the Bundesagentur when the server doesn't offer it", () => {
    const saved = { ...nothingSaved, jobSourcesOn: ["ARBEITSAGENTUR" as const, "FREEHIRE" as const] };
    expect(resolveJobSearchConfig(saved, { DOSSIER_JOBS_ARBEITSAGENTUR: "off" }).sourcesOn).toEqual(["FREEHIRE"]);
  });

  it("lets a saved list win over a saved Off", () => {
    const config = resolveJobSearchConfig({ ...nothingSaved, jobSource: "OFF", jobSourcesOn: ["FREEHIRE"] }, noEnv);
    expect(config).toMatchObject({ sourcesOn: ["FREEHIRE"], source: "FREEHIRE" });
  });

  it("reaches the settings view, with the past 30 days of requests", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const usage = { JSEARCH: { "2026-10-29": 3, "2026-10-01": 2, "2026-09-29": 40 }, ADZUNA: { "2026-09-01": 5 } };
    expect(jobSearchView(resolveJobSearchConfig(nothingSaved, noEnv), usage, now).usage).toEqual({ JSEARCH: 5 });
  });

  it("reaches the settings view", () => {
    const config = resolveJobSearchConfig({ ...nothingSaved, jobSourcesOn: ["ADZUNA", "FREEHIRE"] }, noEnv);
    expect(jobSearchView(config).sourcesOn).toEqual(config.sourcesOn);
  });
});
