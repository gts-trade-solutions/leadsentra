-- Clean placeholder junk that CSV imports stored verbatim in phone / URL
-- columns ("not provided", "n/a", "na", "-", "none", …). The UI then rendered
-- these as clickable links (https://not%20provided). Write-time validation
-- now rejects/clears them (lib/validate.ts); this backfills existing rows.
--
-- Rules:
--   * phone columns  → NULL when the value contains no digit at all, or is a
--     pure placeholder ("0", "-", "n/a", …).
--   * URL columns    → NULL when the value is a placeholder, has no dot
--     (can never be a real hostname), or contains internal whitespace.
--
-- Deliberately conservative: anything that plausibly holds real data
-- (a phone with digits, a URL-shaped string) is left untouched.
--
-- The placeholder pattern is inlined in every statement (rather than a
-- session variable) because user variables carry the connection collation
-- and trip "Illegal mix of collations" against utf8mb4_unicode_ci columns;
-- string literals coerce to the column collation automatically.

-- ---------------------------------------------------------------- contacts
UPDATE contacts
   SET phone = NULL
 WHERE phone IS NOT NULL
   AND (TRIM(phone) = ''
        OR phone NOT REGEXP '[0-9]'
        OR LOWER(TRIM(phone)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$');

UPDATE contacts
   SET linkedin_url = NULL
 WHERE linkedin_url IS NOT NULL
   AND (TRIM(linkedin_url) = ''
        OR LOWER(TRIM(linkedin_url)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
        OR TRIM(linkedin_url) NOT LIKE '%.%'
        OR TRIM(linkedin_url) REGEXP '[[:space:]]');

UPDATE contacts
   SET facebook_url = NULL
 WHERE facebook_url IS NOT NULL
   AND (TRIM(facebook_url) = ''
        OR LOWER(TRIM(facebook_url)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
        OR TRIM(facebook_url) NOT LIKE '%.%'
        OR TRIM(facebook_url) REGEXP '[[:space:]]');

-- Bare Instagram handles ("dayan_aesthetics", "@acme.clinic") are real data,
-- not junk — convert them to full profile URLs BEFORE the null-out pass so
-- the no-dot rule below doesn't wipe them.
UPDATE contacts
   SET instagram_url = CONCAT('https://www.instagram.com/', TRIM(LEADING '@' FROM TRIM(instagram_url)))
 WHERE instagram_url IS NOT NULL
   AND LOWER(TRIM(instagram_url)) NOT REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
   AND TRIM(instagram_url) REGEXP '^@?[A-Za-z0-9][A-Za-z0-9._]{1,29}$'
   AND TRIM(instagram_url) NOT REGEXP '\\.(com|net|org|co|id|in|io|me)$';

UPDATE contacts
   SET instagram_url = NULL
 WHERE instagram_url IS NOT NULL
   AND (TRIM(instagram_url) = ''
        OR LOWER(TRIM(instagram_url)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
        OR TRIM(instagram_url) NOT LIKE '%.%'
        OR TRIM(instagram_url) REGEXP '[[:space:]]');

-- Legacy rows kept socials inside the meta JSON (the list endpoints COALESCE
-- to it), so junk there still surfaces in the UI — scrub it the same way.
UPDATE contacts
   SET meta = JSON_REMOVE(meta, '$.facebook_url')
 WHERE meta IS NOT NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.facebook_url')) IS NOT NULL
   AND (JSON_UNQUOTE(JSON_EXTRACT(meta, '$.facebook_url')) NOT LIKE '%.%'
        OR JSON_UNQUOTE(JSON_EXTRACT(meta, '$.facebook_url')) REGEXP '[[:space:]]');

UPDATE contacts
   SET meta = JSON_REMOVE(meta, '$.instagram_url')
 WHERE meta IS NOT NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.instagram_url')) IS NOT NULL
   AND (JSON_UNQUOTE(JSON_EXTRACT(meta, '$.instagram_url')) NOT LIKE '%.%'
        OR JSON_UNQUOTE(JSON_EXTRACT(meta, '$.instagram_url')) REGEXP '[[:space:]]');

-- --------------------------------------------------------------- companies
UPDATE companies
   SET phone_main = NULL
 WHERE phone_main IS NOT NULL
   AND (TRIM(phone_main) = ''
        OR phone_main NOT REGEXP '[0-9]'
        OR LOWER(TRIM(phone_main)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$');

UPDATE companies
   SET website = NULL
 WHERE website IS NOT NULL
   AND (TRIM(website) = ''
        OR LOWER(TRIM(website)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
        OR TRIM(website) NOT LIKE '%.%'
        OR TRIM(website) REGEXP '[[:space:]]');

UPDATE companies
   SET linkedin = NULL
 WHERE linkedin IS NOT NULL
   AND (TRIM(linkedin) = ''
        OR LOWER(TRIM(linkedin)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
        OR TRIM(linkedin) NOT LIKE '%.%'
        OR TRIM(linkedin) REGEXP '[[:space:]]');

UPDATE companies
   SET facebook_url = NULL
 WHERE facebook_url IS NOT NULL
   AND (TRIM(facebook_url) = ''
        OR LOWER(TRIM(facebook_url)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
        OR TRIM(facebook_url) NOT LIKE '%.%'
        OR TRIM(facebook_url) REGEXP '[[:space:]]');

-- Same handle → URL conversion as contacts, before the null-out pass.
UPDATE companies
   SET instagram_url = CONCAT('https://www.instagram.com/', TRIM(LEADING '@' FROM TRIM(instagram_url)))
 WHERE instagram_url IS NOT NULL
   AND LOWER(TRIM(instagram_url)) NOT REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
   AND TRIM(instagram_url) REGEXP '^@?[A-Za-z0-9][A-Za-z0-9._]{1,29}$'
   AND TRIM(instagram_url) NOT REGEXP '\\.(com|net|org|co|id|in|io|me)$';

UPDATE companies
   SET instagram_url = NULL
 WHERE instagram_url IS NOT NULL
   AND (TRIM(instagram_url) = ''
        OR LOWER(TRIM(instagram_url)) REGEXP '^(n\\.?/?a\\.?|none|nil|null|no|nan|not[[:space:]_-]*provided|not[[:space:]_-]*available|not[[:space:]_-]*found|not[[:space:]_-]*applicable|no[[:space:]_-]+(linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-.,_/\\\\]+|0+)$'
        OR TRIM(instagram_url) NOT LIKE '%.%'
        OR TRIM(instagram_url) REGEXP '[[:space:]]');

-- Company list endpoint falls back to meta.phone_main for legacy rows.
UPDATE companies
   SET meta = JSON_REMOVE(meta, '$.phone_main')
 WHERE meta IS NOT NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.phone_main')) IS NOT NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.phone_main')) NOT REGEXP '[0-9]';
