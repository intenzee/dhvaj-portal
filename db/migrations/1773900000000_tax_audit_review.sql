-- Up Migration
-- Tax Audit review and observations register (Phase 5, F-7).
--
-- The 3CD is reviewed Senior, then Manager, then the signing Partner. Each
-- level signs off once its own review points are cleared; a point raised
-- later, or a clause reopened, takes the sign-offs from that level up away.
-- Points follow the statutory audit's review notes: open → responded →
-- cleared. Anything that may need reporting is flagged into the observations
-- register, and the signing Partner decides which become qualifications or
-- observations in Form 3CA / 3CB.

CREATE TABLE hsdg.tax_audit_review_signoffs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_audit_id       uuid NOT NULL REFERENCES hsdg.tax_audits (id) ON DELETE CASCADE,
  engagement_id      uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  level              text NOT NULL CHECK (level IN ('senior', 'manager', 'partner')),
  employee_id        uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  signed_off_at      timestamptz NOT NULL DEFAULT now(),
  -- Set when a later point or a reopened clause takes the sign-off away.
  superseded_at      timestamptz,
  superseded_reason  text CHECK (length(superseded_reason) <= 300),
  CONSTRAINT tax_audit_review_signoffs_superseded
    CHECK ((superseded_at IS NULL) = (superseded_reason IS NULL))
);
CREATE UNIQUE INDEX tax_audit_review_signoffs_active
  ON hsdg.tax_audit_review_signoffs (tax_audit_id, level) WHERE superseded_at IS NULL;

CREATE TABLE hsdg.tax_audit_review_points (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_audit_id              uuid NOT NULL REFERENCES hsdg.tax_audits (id) ON DELETE CASCADE,
  engagement_id             uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Null: a point on the report as a whole.
  working_paper_id          uuid REFERENCES hsdg.tax_audit_working_papers (id) ON DELETE CASCADE,
  level                     text NOT NULL CHECK (level IN ('senior', 'manager', 'partner')),
  body                      text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  status                    text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responded', 'cleared')),
  raised_by_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  response                  text CHECK (length(response) <= 4000),
  responded_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  responded_at              timestamptz,
  cleared_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  cleared_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT tax_audit_review_points_responded
    CHECK (status = 'open' OR (response IS NOT NULL AND responded_at IS NOT NULL)),
  CONSTRAINT tax_audit_review_points_cleared
    CHECK ((status = 'cleared') = (cleared_at IS NOT NULL))
);
CREATE INDEX tax_audit_review_points_audit_idx ON hsdg.tax_audit_review_points (tax_audit_id, created_at);
CREATE INDEX tax_audit_review_points_open_idx
  ON hsdg.tax_audit_review_points (tax_audit_id) WHERE status <> 'cleared';

CREATE TABLE hsdg.tax_audit_observations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_audit_id             uuid NOT NULL REFERENCES hsdg.tax_audits (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  working_paper_id         uuid REFERENCES hsdg.tax_audit_working_papers (id) ON DELETE SET NULL,
  -- Kept apart from the paper so the report keeps its clause if the paper goes.
  clause_no                text CHECK (length(clause_no) <= 20),
  wording                  text NOT NULL CHECK (length(btrim(wording)) BETWEEN 1 AND 4000),
  -- proposed → accepted (in the report, as a qualification or an observation) or dropped.
  status                   text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dropped')),
  kind                     text CHECK (kind IN ('qualification', 'observation')),
  decision_note            text CHECK (length(decision_note) <= 1000),
  decided_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at               timestamptz,
  raised_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  CONSTRAINT tax_audit_observations_kind CHECK ((status = 'accepted') = (kind IS NOT NULL)),
  CONSTRAINT tax_audit_observations_decided CHECK ((status = 'proposed') = (decided_at IS NULL))
);
CREATE INDEX tax_audit_observations_audit_idx ON hsdg.tax_audit_observations (tax_audit_id, created_at);

-- A review row carries its audit's engagement (RLS reads it), and a clause it
-- names is one of that audit's.
CREATE FUNCTION hsdg.tax_audit_review_row_engagement() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  eng uuid;
  paper_audit uuid;
BEGIN
  SELECT engagement_id INTO eng FROM hsdg.tax_audits WHERE id = NEW.tax_audit_id;
  IF eng IS DISTINCT FROM NEW.engagement_id THEN
    RAISE EXCEPTION 'A tax audit''s review rows belong to its engagement.' USING ERRCODE = 'check_violation';
  END IF;
  -- Sign-offs name no clause (plpgsql does not short-circuit, so nest the test).
  IF TG_TABLE_NAME <> 'tax_audit_review_signoffs' THEN
    IF NEW.working_paper_id IS NOT NULL THEN
      SELECT tax_audit_id INTO paper_audit FROM hsdg.tax_audit_working_papers WHERE id = NEW.working_paper_id;
      IF paper_audit IS DISTINCT FROM NEW.tax_audit_id THEN
        RAISE EXCEPTION 'The clause belongs to another tax audit.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tax_audit_review_signoffs_engagement BEFORE INSERT OR UPDATE ON hsdg.tax_audit_review_signoffs
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_review_row_engagement();
CREATE TRIGGER tax_audit_review_points_engagement BEFORE INSERT OR UPDATE ON hsdg.tax_audit_review_points
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_review_row_engagement();
CREATE TRIGGER tax_audit_observations_engagement BEFORE INSERT OR UPDATE ON hsdg.tax_audit_observations
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_review_row_engagement();
CREATE TRIGGER tax_audit_review_points_set_updated_at BEFORE UPDATE ON hsdg.tax_audit_review_points
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
CREATE TRIGGER tax_audit_observations_set_updated_at BEFORE UPDATE ON hsdg.tax_audit_observations
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Professional evidence: never deleted at runtime.
GRANT SELECT, INSERT, UPDATE ON hsdg.tax_audit_review_signoffs TO hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.tax_audit_review_points TO hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.tax_audit_observations TO hsdg_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_audit_review_signoffs', 'tax_audit_review_points',
                           'tax_audit_observations'] LOOP
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE hsdg.%I FORCE ROW LEVEL SECURITY', t);
    -- Whoever works the engagement sees its review; the service decides who signs off.
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT TO hsdg_app
                      USING (hsdg.is_engagement_member(engagement_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT TO hsdg_app
                      WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE TO hsdg_app
                      USING (hsdg.is_engagement_member(engagement_id))
                      WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY purge_engagement ON hsdg.%I TO hsdg_migrator
                      USING (current_setting(''hsdg.purging'', true) = ''on'')
                      WITH CHECK (current_setting(''hsdg.purging'', true) = ''on'')', t);
    EXECUTE format('CREATE POLICY erase_person ON hsdg.%I TO hsdg_migrator
                      USING (current_setting(''hsdg.erasing_person'', true) = ''on'')
                      WITH CHECK (current_setting(''hsdg.erasing_person'', true) = ''on'')', t);
  END LOOP;
END;
$$;

-- Down Migration

DROP TABLE hsdg.tax_audit_observations;
DROP TABLE hsdg.tax_audit_review_points;
DROP TABLE hsdg.tax_audit_review_signoffs;
DROP FUNCTION hsdg.tax_audit_review_row_engagement();
