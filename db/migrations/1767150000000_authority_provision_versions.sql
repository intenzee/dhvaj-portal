-- Up Migration
-- Authority / Provision Library — effective-dated versions (02.2 spec §20,
-- Implementation Guide §5).
--
-- A provision keeps its stable `code` across versions; superseding appends a
-- row (new effective_from, number / title / source / summary) and closes the
-- old one (effective_to = the day before, superseded_by_id). References resolve
-- by code + date, so a historical engagement opens the version in force for its
-- audit period. Rows are never edited in place except their viewer content.
--
-- `code` is therefore no longer unique on its own: (code, effective_from) and
-- (code, version_no) are, and at most one version per code is open-ended
-- (effective_to IS NULL). Seeds that used `ON CONFLICT (code)` must now say
-- `ON CONFLICT (code) WHERE effective_to IS NULL`.

ALTER TABLE hsdg.authority_provision
  ADD COLUMN version_no             integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  ADD COLUMN change_note            text,
  ADD COLUMN created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL;

ALTER TABLE hsdg.authority_provision DROP CONSTRAINT authority_provision_code_key;
ALTER TABLE hsdg.authority_provision
  ADD CONSTRAINT authority_provision_code_from_key UNIQUE (code, effective_from),
  ADD CONSTRAINT authority_provision_code_version_key UNIQUE (code, version_no);
CREATE UNIQUE INDEX authority_provision_open_version
  ON hsdg.authority_provision (code) WHERE effective_to IS NULL;

-- Down Migration
-- Keep only each code's first version: citations of a later version point back
-- to it, the later versions are removed and the first is re-opened. Then the
-- single-row-per-code key returns.
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
CREATE TEMP TABLE provision_first ON COMMIT DROP AS
  SELECT p.id AS later_id, f.id AS first_id
    FROM hsdg.authority_provision p
    JOIN hsdg.authority_provision f ON f.code = p.code AND f.version_no = 1
   WHERE p.version_no > 1;
UPDATE hsdg.audit_rule_version t SET authority_provision_id = m.first_id
  FROM provision_first m WHERE t.authority_provision_id = m.later_id;
UPDATE hsdg.audit_framework_subassessment t SET authority_provision_id = m.first_id
  FROM provision_first m WHERE t.authority_provision_id = m.later_id;
UPDATE hsdg.audit_entity_profile t SET small_company_provision_id = m.first_id
  FROM provision_first m WHERE t.small_company_provision_id = m.later_id;
UPDATE hsdg.authority_provision SET superseded_by_id = NULL, effective_to = NULL
 WHERE version_no = 1 AND superseded_by_id IN (SELECT later_id FROM provision_first);
DELETE FROM hsdg.authority_provision WHERE version_no > 1;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS hsdg.authority_provision_open_version;
ALTER TABLE hsdg.authority_provision
  DROP CONSTRAINT IF EXISTS authority_provision_code_version_key,
  DROP CONSTRAINT IF EXISTS authority_provision_code_from_key;
ALTER TABLE hsdg.authority_provision ADD CONSTRAINT authority_provision_code_key UNIQUE (code);
ALTER TABLE hsdg.authority_provision
  DROP COLUMN IF EXISTS created_by_employee_id,
  DROP COLUMN IF EXISTS change_note,
  DROP COLUMN IF EXISTS version_no;
