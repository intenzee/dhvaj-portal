-- ─────────────────────────────────────────────────────────────────────────
-- The PAN of a GSTIN only when it is shaped like one
--
-- hsdg.gstin_pan read characters 3–12 of whatever was stored, so a malformed
-- number ('27AABCB5678B1Z4-mvp15l7xgspz', a typo, a placeholder) looked like a
-- GSTIN of another PAN and entities_pan_guard refused to set the client's PAN.
-- A number that is not shaped like a GSTIN carries no PAN: it gives NULL, and
-- both guards let it be (the API already refuses new malformed GSTINs; the data
-- check lists the old ones). The shape is the contracts' GSTIN_SHAPE; the check
-- digit is not needed to read the PAN. No data changes.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.gstin_pan(p_number text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN g ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN substr(g, 3, 10)
         END
    FROM (SELECT upper(regexp_replace(p_number, '\s', '', 'g')) AS g) n
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.gstin_pan(p_number text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(substr(regexp_replace(p_number, '[^0-9A-Za-z]', '', 'g'), 3, 10))
$$;
