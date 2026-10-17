-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-206 · review fix: unbilled fees never drop off.
--
-- firm_settings — billing_from: the day the firm started billing in the app
--                 (its go-live). The unbilled list starts each retainer or
--                 year fee there, or at the fee's own start when it is
--                 null, instead of a rolling twelve months that let an old
--                 fee still unbilled vanish from the list.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings ADD COLUMN billing_from date;

-- Down Migration

ALTER TABLE hsdg.firm_settings DROP COLUMN IF EXISTS billing_from;
