-- 03.1.6 prior-year matters imported from last year's audit file.
--
-- `source_ref` names the prior-year record a matter was brought forward from
-- (e.g. `risk:<uuid>`), so re-importing never duplicates one. Manually added
-- matters keep it NULL.

-- Up Migration
ALTER TABLE hsdg.audit_prior_year_matter ADD COLUMN source_ref text;
CREATE UNIQUE INDEX audit_prior_year_matter_source_ref_uq
  ON hsdg.audit_prior_year_matter (workflow_instance_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS hsdg.audit_prior_year_matter_source_ref_uq;
ALTER TABLE hsdg.audit_prior_year_matter DROP COLUMN IF EXISTS source_ref;
