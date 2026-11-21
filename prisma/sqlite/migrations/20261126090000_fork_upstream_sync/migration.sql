-- Fork only (FORK.md): the sync with upstream 1.15.1 retires the fork's saved
-- searches, multi-provider job search and OpenCode Go. This does for the
-- settings what prisma/migrations/20261126090000_fork_upstream_sync does on
-- PostgreSQL. SQLite never had the fork's columns on AgentCandidate, so there is
-- no candidate tag to convert and nothing to drop.

-- 1. The saved searches (settings "agentSearches") become Agent searches, up to
-- three. The first three, in list order, that upstream can hold (an id, and
-- keywords of 1 to 200 characters) are kept, with their ids; the rest are
-- written to the setting "agentSearchesDropped". A list that was saved at all
-- was the fork's whole list, so the search made from the old single query
-- (agent-search-legacy) is stale and goes. A malformed setting makes nothing.
CREATE TEMP TABLE "_fork_searches" AS
SELECT
  "pos",
  "item",
  CASE WHEN json_type("item") = 'object'
        AND json_type("item", '$.id') = 'text'
        AND length(json_extract("item", '$.id')) BETWEEN 1 AND 40
        AND json_type("item", '$.keywords') = 'text'
        AND length(trim(json_extract("item", '$.keywords'), char(32, 9, 10, 11, 12, 13))) BETWEEN 1 AND 200
       THEN 1 ELSE 0 END AS "valid"
FROM (
  -- Each entry as JSON text, a string or a number too, so it can be looked into.
  SELECT CAST(e."key" AS INTEGER) AS "pos", CASE WHEN e."type" IN ('object', 'array') THEN e."value" ELSE json_quote(e."value") END AS "item"
  FROM "Setting" s,
    json_each(CASE WHEN json_valid(s."value") THEN CASE WHEN json_type(s."value") = 'array' THEN s."value" ELSE '[]' END ELSE '[]' END) e
  WHERE s."key" = 'agentSearches'
);

DELETE FROM "AgentSearch" WHERE "id" = 'agent-search-legacy'
  AND EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'agentSearches' AND json_valid("value") AND json_type("value") = 'array');

-- An id that's already taken, or that comes twice, only counts the first time.
UPDATE "_fork_searches" SET "valid" = 0
WHERE "valid" = 1 AND (
  json_extract("item", '$.id') IN (SELECT "id" FROM "AgentSearch")
  OR EXISTS (SELECT 1 FROM "_fork_searches" o WHERE o."valid" = 1 AND o."pos" < "_fork_searches"."pos" AND json_extract(o."item", '$.id') = json_extract("_fork_searches"."item", '$.id'))
);

INSERT INTO "AgentSearch" ("id", "name", "query", "enabled", "sort", "updatedAt")
SELECT
  json_extract("item", '$.id'),
  COALESCE(
    NULLIF(CASE WHEN json_type("item", '$.name') = 'text' THEN substr(trim(json_extract("item", '$.name'), char(32, 9, 10, 11, 12, 13)), 1, 100) END, ''),
    substr(trim(json_extract("item", '$.keywords'), char(32, 9, 10, 11, 12, 13)), 1, 100)
  ),
  json_object(
    'keywords', trim(json_extract("item", '$.keywords'), char(32, 9, 10, 11, 12, 13)),
    'place', CASE WHEN json_type("item", '$.place') = 'text'
      THEN trim(substr(trim(json_extract("item", '$.place'), char(32, 9, 10, 11, 12, 13)), 1, 200), char(32, 9, 10, 11, 12, 13))
      ELSE '' END,
    'country', CASE WHEN json_type("item", '$.country') = 'text'
        AND lower(trim(json_extract("item", '$.country'), char(32, 9, 10, 11, 12, 13))) GLOB '[a-z][a-z]'
      THEN lower(trim(json_extract("item", '$.country'), char(32, 9, 10, 11, 12, 13)))
      ELSE '' END,
    'radiusKm', CASE WHEN json_type("item", '$.radiusKm') IN ('integer', 'real') AND json_extract("item", '$.radiusKm') IN (10, 25, 50, 100, 200)
      THEN CAST(json_extract("item", '$.radiusKm') AS INTEGER)
      ELSE 25 END,
    'remoteOnly', json(CASE json_type("item", '$.remoteOnly') WHEN 'true' THEN 'true' ELSE 'false' END),
    'postedWithin', CASE WHEN json_type("item", '$.postedWithin') = 'text' AND json_extract("item", '$.postedWithin') IN ('any', 'day', '3days', 'week', 'month')
      THEN json_extract("item", '$.postedWithin')
      ELSE 'any' END
  ),
  CASE WHEN json_type("item", '$.enabled') = 'false' THEN 0 ELSE 1 END,
  ROW_NUMBER() OVER (ORDER BY "pos") - 1,
  CURRENT_TIMESTAMP
FROM (
  SELECT "pos", "item" FROM "_fork_searches" WHERE "valid" = 1
  ORDER BY "pos" LIMIT 3
)
;

INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'agentSearchesDropped', json_group_array(json("item")), CURRENT_TIMESTAMP
FROM (
  SELECT "item" FROM "_fork_searches"
  WHERE "valid" = 0 OR "pos" NOT IN (SELECT "pos" FROM "_fork_searches" WHERE "valid" = 1 ORDER BY "pos" LIMIT 3)
  ORDER BY "pos"
)
HAVING count(*) > 0
ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt";

DROP TABLE "_fork_searches";

-- 2. OpenCode Go becomes the OpenAI-compatible provider pointed at its address.
-- The key stays as it is. An address saved with the Go base URL, or the OpenAI
-- one (.../openai/v1), becomes .../v1; no address, or no model, gets Go's. The
-- enum value stays in the schema so nothing breaks; no code writes it.
INSERT OR IGNORE INTO "Setting" ("key", "value", "updatedAt")
SELECT 'baseUrl', 'https://opencode.ai/inference/go/v1', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'provider' AND "value" = 'OPENCODE_GO');

UPDATE "Setting" SET "updatedAt" = CURRENT_TIMESTAMP,
  "value" = CASE
    WHEN trim("value") = '' THEN 'https://opencode.ai/inference/go/v1'
    WHEN rtrim(trim("value"), '/') LIKE '%/openai/v1' THEN substr(rtrim(trim("value"), '/'), 1, length(rtrim(trim("value"), '/')) - 10) || '/v1'
    WHEN rtrim(trim("value"), '/') LIKE '%/openai' THEN substr(rtrim(trim("value"), '/'), 1, length(rtrim(trim("value"), '/')) - 7) || '/v1'
    WHEN rtrim(trim("value"), '/') LIKE '%/v1' THEN rtrim(trim("value"), '/')
    ELSE rtrim(trim("value"), '/') || '/v1'
  END
WHERE "key" = 'baseUrl' AND EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'provider' AND "value" = 'OPENCODE_GO');

INSERT OR IGNORE INTO "Setting" ("key", "value", "updatedAt")
SELECT 'model', 'glm-5.3-flash', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'provider' AND "value" = 'OPENCODE_GO');

UPDATE "Setting" SET "value" = 'glm-5.3-flash', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'model' AND trim("value") = '' AND EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'provider' AND "value" = 'OPENCODE_GO');

UPDATE "Setting" SET "value" = 'OPENAI', "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'provider' AND "value" = 'OPENCODE_GO';

-- 3. The fork's other settings go. Of the providers that were on together
-- ("jobSourcesOn"), the first becomes the single source ("jobSource") while none
-- is chosen and the portals haven't been saved yet, so one portal is on and the
-- keys saved with each provider stay where upstream reads them. The request
-- counts ("jobSourceUsage") and the per-provider caps ("agentSourceCaps") have no
-- place upstream.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'jobSource', first_on, CURRENT_TIMESTAMP FROM (
  SELECT j."value" AS first_on
  FROM "Setting" s,
    json_each(CASE WHEN json_valid(s."value") THEN CASE WHEN json_type(s."value") = 'array' THEN s."value" ELSE '[]' END ELSE '[]' END) j
  WHERE s."key" = 'jobSourcesOn' AND j."type" = 'text' AND j."value" IN ('JSEARCH', 'ADZUNA', 'FREEHIRE', 'ARBEITSAGENTUR')
  ORDER BY CAST(j."key" AS INTEGER) LIMIT 1
)
WHERE NOT EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'portals')
  AND NOT EXISTS (SELECT 1 FROM "Setting" WHERE "key" = 'jobSource' AND "value" <> 'OFF')
ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt";

DELETE FROM "Setting" WHERE "key" IN ('agentSearches', 'agentSourceCaps', 'jobSourceUsage', 'jobSourcesOn');
