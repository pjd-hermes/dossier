import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { isSqliteUrl } from "@/lib/database";
import { testDatabaseUrl } from "@/test/db";

// The fork's sync migration (FORK.md): the saved searches, OpenCode Go and the
// multi-provider settings become what upstream keeps, before the fork's columns go.
// PostgreSQL runs the real migration against a minimal schema in a transaction that
// rolls back, schema and all; SQLite runs its own against the same tables in memory.

type Setting = [key: string, value: string];
type Candidate = { id: string; searchId?: string | null; searchName?: string };
type Upgraded = {
  searches: { id: string; name: string; enabled: boolean; sort: number; query: Record<string, unknown> }[];
  settings: Record<string, string>;
  attributions: { candidateId: string; searchId: string | null; searchName: string }[];
};

const MIGRATION = "20261126090000_fork_upstream_sync";
const sqlite = () => isSqliteUrl(testDatabaseUrl());

const entry = (id: string, keywords: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Search ${id}`,
  keywords,
  place: "Berlin",
  country: "de",
  radiusKm: 50,
  remoteOnly: false,
  postedWithin: "week",
  enabled: true,
  ...extra,
});

async function upgradePostgres(settings: Setting[], candidates: Candidate[], legacy: boolean): Promise<Upgraded> {
  const db = new Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("CREATE SCHEMA fork_sync_test");
    await db.query("SET LOCAL search_path TO fork_sync_test");
    await db.query('CREATE TABLE "Setting" ("key" text PRIMARY KEY, "value" text NOT NULL, "updatedAt" timestamp(3) NOT NULL)');
    await db.query(`CREATE TABLE "AgentSearch" (
      "id" text PRIMARY KEY, "name" text NOT NULL, "query" jsonb NOT NULL, "enabled" boolean NOT NULL DEFAULT true,
      "sort" integer NOT NULL DEFAULT 0, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL)`);
    await db.query(`CREATE TABLE "AgentCandidate" ("id" text PRIMARY KEY, "searchId" text, "searchName" text NOT NULL DEFAULT '')`);
    await db.query('CREATE INDEX "AgentCandidate_searchId_idx" ON "AgentCandidate"("searchId")');
    await db.query(`CREATE TABLE "AgentCandidateSearch" (
      "id" text PRIMARY KEY, "candidateId" text NOT NULL REFERENCES "AgentCandidate"("id") ON DELETE CASCADE,
      "searchId" text REFERENCES "AgentSearch"("id") ON DELETE SET NULL, "searchName" text NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("candidateId", "searchId"))`);
    if (legacy) await db.query(`INSERT INTO "AgentSearch" ("id", "name", "query", "updatedAt") VALUES ('agent-search-legacy', 'My search', '{"keywords":"Old"}', CURRENT_TIMESTAMP)`);
    for (const [key, value] of settings) await db.query('INSERT INTO "Setting" VALUES ($1, $2, CURRENT_TIMESTAMP)', [key, value]);
    for (const { id, searchId = null, searchName = "" } of candidates) {
      await db.query('INSERT INTO "AgentCandidate" ("id", "searchId", "searchName") VALUES ($1, $2, $3)', [id, searchId, searchName]);
    }
    await db.query(await readFile(`prisma/migrations/${MIGRATION}/migration.sql`, "utf8"));
    const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'fork_sync_test' AND table_name = 'AgentCandidate'`)).rows;
    expect(columns.map((row) => row.column_name)).toEqual(["id"]);
    const searches = (await db.query('SELECT * FROM "AgentSearch" ORDER BY "sort", "id"')).rows;
    return {
      searches,
      settings: Object.fromEntries((await db.query('SELECT "key", "value" FROM "Setting" ORDER BY "key"')).rows.map((row) => [row.key, row.value])),
      attributions: (await db.query('SELECT "candidateId", "searchId", "searchName" FROM "AgentCandidateSearch" ORDER BY "candidateId"')).rows,
    };
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}

async function upgradeSqlite(settings: Setting[], _candidates: Candidate[], legacy: boolean): Promise<Upgraded> {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec('CREATE TABLE "Setting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL)');
    db.exec(`CREATE TABLE "AgentSearch" (
      "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "query" JSONB NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
      "sort" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`);
    if (legacy) db.exec(`INSERT INTO "AgentSearch" ("id", "name", "query", "updatedAt") VALUES ('agent-search-legacy', 'My search', '{"keywords":"Old"}', CURRENT_TIMESTAMP)`);
    for (const [key, value] of settings) db.prepare('INSERT INTO "Setting" VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
    db.exec(await readFile(`prisma/sqlite/migrations/${MIGRATION}/migration.sql`, "utf8"));
    const searches = db.prepare('SELECT * FROM "AgentSearch" ORDER BY "sort", "id"').all() as unknown as (Omit<Upgraded["searches"][number], "query" | "enabled"> & { query: string; enabled: number })[];
    return {
      searches: searches.map((row) => ({ ...row, enabled: Boolean(row.enabled), query: JSON.parse(row.query) as Record<string, unknown> })),
      settings: Object.fromEntries((db.prepare('SELECT "key", "value" FROM "Setting" ORDER BY "key"').all() as { key: string; value: string }[]).map((row) => [row.key, row.value])),
      attributions: [],
    };
  } finally {
    db.close();
  }
}

const upgrade = (settings: Setting[], candidates: Candidate[] = [], legacy = false) =>
  sqlite() ? upgradeSqlite(settings, candidates, legacy) : upgradePostgres(settings, candidates, legacy);

const list = (...entries: unknown[]): Setting => ["agentSearches", JSON.stringify(entries)];

describe("The fork's upstream sync migration", () => {
  describe("saved searches", () => {
    it("keeps the first three in list order, as they were, and sets the rest aside", async () => {
      const searches = [1, 2, 3, 4, 5].map((n) => entry(`s${n}`, ` Designer ${n} `, n === 2 ? { enabled: false, radiusKm: 100, remoteOnly: true } : {}));
      const { searches: saved, settings } = await upgrade([list(...searches), ["jsearchKeyEnc", "secret"]]);
      expect(saved.map(({ id, name, sort }) => [id, name, sort])).toEqual([["s1", "Search s1", 0], ["s2", "Search s2", 1], ["s3", "Search s3", 2]]);
      expect(saved.map((search) => search.enabled)).toEqual([true, false, true]);
      expect(saved[0].query).toEqual({ keywords: "Designer 1", place: "Berlin", country: "de", radiusKm: 50, remoteOnly: false, postedWithin: "week" });
      expect(saved[1].query).toMatchObject({ radiusKm: 100, remoteOnly: true });
      expect(JSON.parse(settings.agentSearchesDropped)).toEqual(searches.slice(3));
      expect(settings).not.toHaveProperty("agentSearches");
      expect(settings.jsearchKeyEnc).toBe("secret");
    });

    it("keeps every search when there are three or fewer, and notes nothing", async () => {
      const { searches, settings } = await upgrade([list(entry("a", "Chef"), entry("b", "Cook"))]);
      expect(searches.map((search) => search.id)).toEqual(["a", "b"]);
      expect(settings).toEqual({});
    });

    it("skips what upstream can't hold without using up one of the three", async () => {
      const bad = [entry("empty", "  "), { ...entry("noid", "X"), id: undefined }, entry("long", "x".repeat(201)), "text", null, entry("ok1", "A"), entry("ok2", "B"), entry("ok3", "C"), entry("ok4", "D")];
      const { searches, settings } = await upgrade([list(...bad)]);
      expect(searches.map((search) => search.id)).toEqual(["ok1", "ok2", "ok3"]);
      expect(JSON.parse(settings.agentSearchesDropped)).toEqual(JSON.parse(JSON.stringify([...bad.slice(0, 5), entry("ok4", "D")])));
    });

    it("repairs the optional fields as upstream's own upgrade does", async () => {
      const { searches } = await upgrade([list({ id: "r", keywords: "Engineer", place: " x".repeat(300), country: " DE ", radiusKm: 42, remoteOnly: "yes", postedWithin: "forever", name: "  " })]);
      expect(searches[0].name).toBe("Engineer");
      expect(searches[0].enabled).toBe(true);
      expect(searches[0].query).toMatchObject({ keywords: "Engineer", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" });
      expect((searches[0].query.place as string).length).toBeLessThanOrEqual(200);
    });

    it("takes an id once, and not one that is already a search", async () => {
      const { searches, settings } = await upgrade([list(entry("same", "A"), entry("same", "B"), entry("agent-search-legacy", "C"), entry("fresh", "D"))], [], true);
      // The list was the whole list, so the legacy search goes before its id is looked at.
      expect(searches.map((search) => [search.id, search.query.keywords])).toEqual([["same", "A"], ["agent-search-legacy", "C"], ["fresh", "D"]]);
      expect(JSON.parse(settings.agentSearchesDropped)).toEqual([entry("same", "B")]);
    });

    it("removes the search made from the old single query when a list was saved, even an empty one", async () => {
      expect((await upgrade([list()], [], true)).searches).toEqual([]);
    });

    it("leaves the search made from the old single query when no list was saved", async () => {
      const { searches } = await upgrade([["jsearchKeyEnc", "secret"]], [], true);
      expect(searches.map((search) => search.id)).toEqual(["agent-search-legacy"]);
    });

    it.each([["{broken"], ["null"], ['{"keywords":"x"}'], ["42"]])("lets a setting that isn't a list pass (%s)", async (value) => {
      const { searches, settings } = await upgrade([["agentSearches", value]], [], true);
      expect(searches.map((search) => search.id)).toEqual(["agent-search-legacy"]);
      expect(settings).not.toHaveProperty("agentSearchesDropped");
    });
  });

  it.skipIf(sqlite())("turns each candidate's tag into an attribution, and drops the columns", async () => {
    const { attributions, searches } = await upgrade(
      [list(...[1, 2, 3, 4].map((n) => entry(`s${n}`, `K${n}`)))],
      [
        { id: "c1", searchId: "s1", searchName: "Renamed since" },
        { id: "c2", searchId: "s3", searchName: "" },
        { id: "c3", searchId: "s4", searchName: "Dropped one" },
        { id: "c4", searchId: "gone", searchName: "Removed one" },
        { id: "c5", searchId: "gone", searchName: "" },
        { id: "c6", searchId: null, searchName: "Name only" },
        { id: "c7" },
      ],
    );
    expect(searches.map((search) => search.id)).toEqual(["s1", "s2", "s3"]);
    expect(attributions).toEqual([
      { candidateId: "c1", searchId: "s1", searchName: "Renamed since" },
      { candidateId: "c2", searchId: "s3", searchName: "Search s3" },
      { candidateId: "c3", searchId: null, searchName: "Dropped one" },
      { candidateId: "c4", searchId: null, searchName: "Removed one" },
      { candidateId: "c5", searchId: null, searchName: "Removed search" },
      { candidateId: "c6", searchId: null, searchName: "Name only" },
    ]);
  });

  it.skipIf(sqlite())("points the candidates of the single search at the search made from it", async () => {
    const { attributions } = await upgrade([], [{ id: "c1", searchId: "legacy", searchName: "Designer" }, { id: "c2", searchId: "legacy" }], true);
    expect(attributions).toEqual([
      { candidateId: "c1", searchId: "agent-search-legacy", searchName: "Designer" },
      { candidateId: "c2", searchId: "agent-search-legacy", searchName: "My search" },
    ]);
  });

  describe("OpenCode Go", () => {
    const saved = (...rest: Setting[]): Setting[] => [["provider", "OPENCODE_GO"], ["apiKeyEnc", "enc:key"], ...rest];

    it.each([
      ["the Go base URL", "https://opencode.ai/inference/go", "https://opencode.ai/inference/go/v1"],
      ["with a slash", " https://opencode.ai/inference/go/ ", "https://opencode.ai/inference/go/v1"],
      ["the OpenAI-compatible URL", "https://opencode.ai/inference/go/openai/v1", "https://opencode.ai/inference/go/v1"],
      ["its /openai", "https://opencode.ai/inference/go/openai", "https://opencode.ai/inference/go/v1"],
      ["already /v1", "https://opencode.ai/inference/go/v1/", "https://opencode.ai/inference/go/v1"],
      ["nothing", "", "https://opencode.ai/inference/go/v1"],
    ])("becomes OpenAI with its address from %s, keeping the key and the model", async (_, address, expected) => {
      const { settings } = await upgrade(saved(["baseUrl", address], ["model", "kimi-k2"]));
      expect(settings).toMatchObject({ provider: "OPENAI", baseUrl: expected, model: "kimi-k2", apiKeyEnc: "enc:key" });
    });

    it("fills in the address and model it was using by default", async () => {
      const { settings } = await upgrade(saved());
      expect(settings).toMatchObject({ provider: "OPENAI", baseUrl: "https://opencode.ai/inference/go/v1", model: "glm-5.3-flash", apiKeyEnc: "enc:key" });
      expect((await upgrade(saved(["model", " "]))).settings.model).toBe("glm-5.3-flash");
    });

    it("leaves every other provider as it is", async () => {
      const rows: Setting[] = [["provider", "OPENAI"], ["baseUrl", "https://api.example.com/v1"], ["model", "gpt"], ["apiKeyEnc", "enc:other"]];
      expect((await upgrade(rows)).settings).toEqual(Object.fromEntries(rows));
      expect((await upgrade([["baseUrl", "https://opencode.ai/inference/go"]])).settings).toEqual({ baseUrl: "https://opencode.ai/inference/go" });
    });
  });

  describe("the multi-provider settings", () => {
    const on = (...sources: string[]): Setting => ["jobSourcesOn", JSON.stringify(sources)];

    it("go, and the first provider that was on becomes the single source while none is chosen", async () => {
      const { settings } = await upgrade([on("FREEHIRE", "JSEARCH"), ["jobSourceUsage", '{"JSEARCH":{"2026-11-01":3}}'], ["agentSourceCaps", '{"JSEARCH":2}'], ["jsearchKeyEnc", "k1"], ["adzunaKeyEnc", "k2"], ["adzunaAppId", "id"]]);
      expect(settings).toEqual({ adzunaAppId: "id", adzunaKeyEnc: "k2", jobSource: "FREEHIRE", jsearchKeyEnc: "k1" });
    });

    it("replaces a saved Off, as the list beat it before", async () => {
      expect((await upgrade([on("ADZUNA"), ["jobSource", "OFF"]])).settings).toEqual({ jobSource: "ADZUNA" });
    });

    it("leaves a chosen source, and portals already saved, alone", async () => {
      expect((await upgrade([on("ADZUNA"), ["jobSource", "JSEARCH"]])).settings).toEqual({ jobSource: "JSEARCH" });
      expect((await upgrade([on("ADZUNA"), ["portals", "{}"]])).settings).toEqual({ portals: "{}" });
    });

    it.each([[["jobSourcesOn", "[]"]], [["jobSourcesOn", "{broken"]], [["jobSourcesOn", '["OTHER"]']], [["jobSourcesOn", "null"]]] as [Setting][])("makes no source from %s", async (row) => {
      expect((await upgrade([row])).settings).toEqual({});
    });
  });
});
