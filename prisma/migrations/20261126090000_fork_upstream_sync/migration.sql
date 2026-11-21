-- Fork only (FORK.md): the sync with upstream 1.15.1 retires the fork's saved
-- searches, multi-provider job search and OpenCode Go. This turns the data they
-- made into what upstream keeps it in, before the fork's columns go. It runs
-- after upstream's own migrations (its timestamp is later than all of them).
-- prisma/sqlite/migrations/20261126090000_fork_upstream_sync does the same for
-- the settings on SQLite, which never had the columns.

-- 1. The saved searches (settings "agentSearches", up to five) become Agent
-- searches, up to three (MAX_AGENT_SEARCHES). The first three, in list order, that
-- upstream can hold (an id, and keywords of 1 to 200 characters) are kept, with
-- their ids, so the candidates' tags below can point at them. The rest are not
-- lost: they are written to the setting "agentSearchesDropped", as the fork
-- saved them. A list that was saved at all, even an empty one, was the fork's
-- whole list, so the search that upstream's migration made from the old single
-- query ("agentQuery", id agent-search-legacy) is stale and goes.
-- A malformed setting must not stop the upgrade.
DO $$
DECLARE
  listed JSONB;
  item RECORD;
  keywords TEXT;
  place TEXT;
  country TEXT;
  label TEXT;
  kept INTEGER := 0;
  dropped JSONB := '[]'::jsonb;
BEGIN
  BEGIN
    SELECT "value"::jsonb INTO listed FROM "Setting" WHERE "key" = 'agentSearches';
  EXCEPTION WHEN invalid_text_representation THEN
    listed := NULL;
  END;

  IF jsonb_typeof(listed) = 'array' THEN
    DELETE FROM "AgentSearch" WHERE "id" = 'agent-search-legacy';

    FOR item IN SELECT entry FROM jsonb_array_elements(listed) WITH ORDINALITY AS t(entry, ord) ORDER BY ord LOOP
      keywords := '';
      IF jsonb_typeof(item.entry) = 'object' AND jsonb_typeof(item.entry->'keywords') = 'string' THEN
        keywords := regexp_replace(item.entry->>'keywords', '^\s+|\s+$', '', 'g');
      END IF;

      IF kept < 3 AND length(keywords) BETWEEN 1 AND 200
         AND jsonb_typeof(item.entry->'id') = 'string' AND length(item.entry->>'id') BETWEEN 1 AND 40
         AND NOT EXISTS (SELECT 1 FROM "AgentSearch" WHERE "id" = item.entry->>'id') THEN
        place := regexp_replace(left(regexp_replace(CASE WHEN jsonb_typeof(item.entry->'place') = 'string' THEN item.entry->>'place' ELSE '' END, '^\s+|\s+$', '', 'g'), 200), '^\s+|\s+$', '', 'g');
        country := CASE WHEN jsonb_typeof(item.entry->'country') = 'string' THEN lower(regexp_replace(item.entry->>'country', '^\s+|\s+$', '', 'g')) ELSE '' END;
        label := CASE WHEN jsonb_typeof(item.entry->'name') = 'string' THEN left(regexp_replace(item.entry->>'name', '^\s+|\s+$', '', 'g'), 100) ELSE '' END;
        IF label = '' THEN label := left(keywords, 100); END IF;

        INSERT INTO "AgentSearch" ("id", "name", "query", "enabled", "sort", "updatedAt")
        VALUES (
          item.entry->>'id',
          label,
          jsonb_build_object(
            'keywords', keywords,
            'place', place,
            'country', CASE WHEN country ~ '^[a-z]{2}$' THEN country ELSE '' END,
            'radiusKm', CASE WHEN item.entry->'radiusKm' IN ('10'::jsonb, '25'::jsonb, '50'::jsonb, '100'::jsonb, '200'::jsonb) THEN item.entry->'radiusKm' ELSE '25'::jsonb END,
            'remoteOnly', CASE WHEN jsonb_typeof(item.entry->'remoteOnly') = 'boolean' THEN item.entry->'remoteOnly' ELSE 'false'::jsonb END,
            'postedWithin', CASE WHEN item.entry->>'postedWithin' IN ('any', 'day', '3days', 'week', 'month') THEN item.entry->>'postedWithin' ELSE 'any' END
          ),
          CASE WHEN jsonb_typeof(item.entry->'enabled') = 'boolean' THEN (item.entry->>'enabled')::boolean ELSE true END,
          kept,
          CURRENT_TIMESTAMP
        );
        kept := kept + 1;
      ELSE
        dropped := dropped || jsonb_build_array(item.entry);
      END IF;
    END LOOP;

    IF jsonb_array_length(dropped) > 0 THEN
      RAISE NOTICE 'Fork sync: % saved search(es) did not fit upstream''s three and are kept in the setting "agentSearchesDropped".', jsonb_array_length(dropped);
      INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ('agentSearchesDropped', dropped::text, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt";
    END IF;
  END IF;
END $$;

-- 2. Each candidate's tag (searchId, searchName) becomes an attribution row, as
-- upstream keeps them. A search that was dropped or removed leaves searchId empty
-- and its name, as upstream does for a deleted search. Before there were several
-- searches, the single one was tagged "legacy": it's agent-search-legacy now,
-- while that still exists. Candidates with no tag at all get no row.
INSERT INTO "AgentCandidateSearch" ("id", "candidateId", "searchId", "searchName")
SELECT
  gen_random_uuid()::text,
  c."id",
  COALESCE(s."id", legacy."id"),
  COALESCE(NULLIF(c."searchName", ''), s."name", legacy."name", 'Removed search')
FROM "AgentCandidate" c
LEFT JOIN "AgentSearch" s ON s."id" = c."searchId"
LEFT JOIN "AgentSearch" legacy ON legacy."id" = 'agent-search-legacy' AND c."searchId" = 'legacy' AND s."id" IS NULL
WHERE c."searchId" IS NOT NULL OR c."searchName" <> '';

DROP INDEX "AgentCandidate_searchId_idx";
ALTER TABLE "AgentCandidate" DROP COLUMN "searchId", DROP COLUMN "searchName";

-- 3. OpenCode Go becomes the OpenAI-compatible provider pointed at its address
-- (upstream knows OpenCode's servers by their host and adds what they need). The
-- key stays as it is. An address saved with the Go base URL, or the OpenAI one
-- (.../openai/v1), becomes .../v1, which chat and the model list both answer at; no
-- address, or no model, gets Go's. The enum value stays so nothing breaks; no code
-- writes it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'provider' AND "value" = 'OPENCODE_GO') THEN
    INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ('baseUrl', 'https://opencode.ai/inference/go/v1', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
    UPDATE "Setting" SET "updatedAt" = CURRENT_TIMESTAMP,
      "value" = CASE
        WHEN btrim("value") = '' THEN 'https://opencode.ai/inference/go/v1'
        ELSE regexp_replace(regexp_replace(rtrim(btrim("value"), '/'), '/openai(/v1)?$', ''), '/v1$', '') || '/v1'
      END
    WHERE "key" = 'baseUrl';
    INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ('model', 'glm-5.3-flash', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
    UPDATE "Setting" SET "value" = 'glm-5.3-flash', "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'model' AND btrim("value") = '';
    UPDATE "Setting" SET "value" = 'OPENAI', "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'provider';
  END IF;
END $$;

-- 4. The fork's other settings go. Upstream keeps the providers on, and their
-- keys, in "portals" and "portalKeysEnc", which it fills from the old single
-- source ("jobSource") and the keys saved with it (jsearchKeyEnc, adzunaKeyEnc,
-- adzunaAppId, jsearchHost): those stay. Of the providers that were on together
-- ("jobSourcesOn"), the first becomes the single source while none is chosen
-- and the portals haven't been saved yet, so one portal is on; the others are
-- switched on again in Settings -> Job search, with their keys already there.
-- The request counts ("jobSourceUsage") and the per-provider caps
-- ("agentSourceCaps") have no place upstream, which counts runs and has its own limit.
DO $$
DECLARE
  first_on TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'portals')
     AND NOT EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'jobSource' AND "value" <> 'OFF') THEN
    BEGIN
      SELECT t.entry INTO first_on
      FROM "Setting" s, jsonb_array_elements_text(s."value"::jsonb) WITH ORDINALITY AS t(entry, ord)
      WHERE s."key" = 'jobSourcesOn' AND t.entry IN ('JSEARCH', 'ADZUNA', 'FREEHIRE', 'ARBEITSAGENTUR')
      ORDER BY t.ord LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      first_on := NULL;
    END;
    IF first_on IS NOT NULL THEN
      INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ('jobSource', first_on, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt";
    END IF;
  END IF;
END $$;

DELETE FROM "Setting" WHERE "key" IN ('agentSearches', 'agentSourceCaps', 'jobSourceUsage', 'jobSourcesOn');
