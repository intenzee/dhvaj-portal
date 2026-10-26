-- ─────────────────────────────────────────────────────────────────────────
-- CM-2 · State from the GSTIN, with a dropdown and a mismatch prompt
--
-- A registration's state is a two-digit GST code. One that differs from its
-- GSTIN's first two digits is allowed once someone confirms it (D8): who and
-- when are kept here. Addresses gain a state_code beside the free-text state,
-- which stays for display until CM-9.
--
-- Existing values are normalised: a state name ("New Delhi", "NCT of Delhi",
-- "Haryana ") becomes its code, an empty GSTIN state takes the GSTIN prefix.
-- Rows that cannot be read are left as they are (CM-9 lists them). The name
-- list mirrors GST_STATES and STATE_ALIASES in contracts/credentials.ts.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.entity_registrations
  ADD COLUMN state_mismatch_ack_by uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN state_mismatch_ack_at timestamptz;

ALTER TABLE hsdg.entity_addresses ADD COLUMN state_code text
  CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$');

CREATE TEMP TABLE cm2_state_names (key text PRIMARY KEY, code text NOT NULL);
INSERT INTO cm2_state_names (key, code) VALUES
    ('jammuandkashmir', '01'),
    ('himachalpradesh', '02'),
    ('punjab', '03'),
    ('chandigarh', '04'),
    ('uttarakhand', '05'),
    ('haryana', '06'),
    ('delhi', '07'),
    ('rajasthan', '08'),
    ('uttarpradesh', '09'),
    ('bihar', '10'),
    ('sikkim', '11'),
    ('arunachalpradesh', '12'),
    ('nagaland', '13'),
    ('manipur', '14'),
    ('mizoram', '15'),
    ('tripura', '16'),
    ('meghalaya', '17'),
    ('assam', '18'),
    ('westbengal', '19'),
    ('jharkhand', '20'),
    ('odisha', '21'),
    ('chhattisgarh', '22'),
    ('madhyapradesh', '23'),
    ('gujarat', '24'),
    ('dadraandnagarhavelianddamananddiu', '26'),
    ('maharashtra', '27'),
    ('karnataka', '29'),
    ('goa', '30'),
    ('lakshadweep', '31'),
    ('kerala', '32'),
    ('tamilnadu', '33'),
    ('puducherry', '34'),
    ('andamanandnicobarislands', '35'),
    ('telangana', '36'),
    ('andhrapradesh', '37'),
    ('ladakh', '38'),
    ('otherterritory', '97'),
    ('newdelhi', '07'),
    ('nctofdelhi', '07'),
    ('ncr', '07'),
    ('jk', '01'),
    ('jandk', '01'),
    ('jammu', '01'),
    ('kashmir', '01'),
    ('hp', '02'),
    ('pb', '03'),
    ('uk', '05'),
    ('uttaranchal', '05'),
    ('hr', '06'),
    ('gurgaon', '06'),
    ('gurugram', '06'),
    ('faridabad', '06'),
    ('rj', '08'),
    ('jaipur', '08'),
    ('up', '09'),
    ('noida', '09'),
    ('greaternoida', '09'),
    ('ghaziabad', '09'),
    ('lucknow', '09'),
    ('wb', '19'),
    ('bengal', '19'),
    ('kolkata', '19'),
    ('calcutta', '19'),
    ('orissa', '21'),
    ('chattisgarh', '22'),
    ('mp', '23'),
    ('ahmedabad', '24'),
    ('surat', '24'),
    ('daman', '26'),
    ('diu', '26'),
    ('mh', '27'),
    ('mumbai', '27'),
    ('bombay', '27'),
    ('pune', '27'),
    ('ka', '29'),
    ('bangalore', '29'),
    ('bengaluru', '29'),
    ('tn', '33'),
    ('chennai', '33'),
    ('pondicherry', '34'),
    ('ts', '36'),
    ('hyderabad', '36'),
    ('ap', '37'),
    ('srinagar', '01'),
    ('shimla', '02'),
    ('mohali', '03'),
    ('ludhiana', '03'),
    ('amritsar', '03'),
    ('jalandhar', '03'),
    ('patiala', '03'),
    ('dehradun', '05'),
    ('haridwar', '05'),
    ('panchkula', '06'),
    ('sonipat', '06'),
    ('sonepat', '06'),
    ('karnal', '06'),
    ('ambala', '06'),
    ('panipat', '06'),
    ('rohtak', '06'),
    ('delhincr', '07'),
    ('jodhpur', '08'),
    ('udaipur', '08'),
    ('kota', '08'),
    ('kanpur', '09'),
    ('varanasi', '09'),
    ('agra', '09'),
    ('meerut', '09'),
    ('prayagraj', '09'),
    ('allahabad', '09'),
    ('patna', '10'),
    ('guwahati', '18'),
    ('ranchi', '20'),
    ('jamshedpur', '20'),
    ('bhubaneswar', '21'),
    ('raipur', '22'),
    ('indore', '23'),
    ('bhopal', '23'),
    ('gujrat', '24'),
    ('vadodara', '24'),
    ('baroda', '24'),
    ('rajkot', '24'),
    ('gandhinagar', '24'),
    ('silvassa', '26'),
    ('nagpur', '27'),
    ('thane', '27'),
    ('navimumbai', '27'),
    ('nashik', '27'),
    ('mysore', '29'),
    ('mysuru', '29'),
    ('panaji', '30'),
    ('panjim', '30'),
    ('kochi', '32'),
    ('cochin', '32'),
    ('ernakulam', '32'),
    ('trivandrum', '32'),
    ('thiruvananthapuram', '32'),
    ('coimbatore', '33'),
    ('madurai', '33'),
    ('secunderabad', '36'),
    ('visakhapatnam', '37'),
    ('vizag', '37'),
    ('vijayawada', '37'),
    ('leh', '38')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION pg_temp.cm2_state_code(raw text) RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN raw IS NULL OR btrim(raw) = '' THEN NULL
    WHEN btrim(raw) ~ '^[0-9]{2}$' THEN
      (SELECT code FROM cm2_state_names WHERE code = btrim(raw) LIMIT 1)
    ELSE (SELECT code FROM cm2_state_names
           WHERE key = regexp_replace(replace(lower(raw), '&', 'and'), '[^a-z]', '', 'g'))
  END
$$;

ALTER TABLE hsdg.entity_registrations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_addresses     NO FORCE ROW LEVEL SECURITY;

-- A readable name or a padded code becomes the two-digit code.
UPDATE hsdg.entity_registrations
   SET state_code = pg_temp.cm2_state_code(state_code)
 WHERE state_code IS NOT NULL
   AND pg_temp.cm2_state_code(state_code) IS NOT NULL
   AND state_code IS DISTINCT FROM pg_temp.cm2_state_code(state_code);
-- An empty GSTIN state takes the GSTIN's prefix.
UPDATE hsdg.entity_registrations
   SET state_code = left(registration_number, 2)
 WHERE registration_type = 'gstin'
   AND (state_code IS NULL OR btrim(state_code) = '')
   AND pg_temp.cm2_state_code(left(registration_number, 2)) IS NOT NULL;

UPDATE hsdg.entity_addresses
   SET state_code = pg_temp.cm2_state_code(state)
 WHERE pg_temp.cm2_state_code(state) IS NOT NULL;

ALTER TABLE hsdg.entity_registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_addresses     FORCE ROW LEVEL SECURITY;

DROP TABLE cm2_state_names;

-- Down Migration

ALTER TABLE hsdg.entity_addresses DROP COLUMN IF EXISTS state_code;
ALTER TABLE hsdg.entity_registrations
  DROP COLUMN IF EXISTS state_mismatch_ack_at,
  DROP COLUMN IF EXISTS state_mismatch_ack_by;
