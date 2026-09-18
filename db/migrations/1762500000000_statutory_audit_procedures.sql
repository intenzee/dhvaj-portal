-- ─────────────────────────────────────────────────────────────────────────
-- 0045 · Statutory Audit — Audit-Area Execution: procedures, evidence,
--        exceptions + reuse  (SA-5 · §9–§14)
--
-- SA-3 generated the applicable work areas (top of the §20 cascade). SA-5 is the
-- execution layer INSIDE each area: the professional procedures, the evidence
-- that supports them and the exceptions they surface — plus the two reuse rules
-- (§9, §14): a procedure is one source record linkable to several areas, and a
-- piece of evidence is one source record linkable to several procedures ("do the
-- work once; use the evidence many times").
--
-- CHANGES:
--   • audit_work_areas — add the §11 area-detail overlay (owner, reviewer, risk
--     level, materiality, timing, financial data, conclusion + draft/submitted).
--     These live on the existing row and are PRESERVED across framework
--     regeneration — the SA-3 generate() upsert never touches these columns.
--   • audit_procedures — one professional procedure/workpaper per row (§12/§13):
--     objective, assertions, optional risk response, population/sampling,
--     owner/reviewer/due, expected evidence, conclusion and §8 state. Ref unique
--     per engagement.
--   • audit_procedure_areas — additional areas a procedure supports beyond its
--     home area (§14 cross-referencing). The procedure stays one record.
--   • audit_evidence — an engagement-level, reusable evidence record (§9, §12),
--     optionally linked to a DHVAJ document.
--   • audit_evidence_procedures — which procedures a piece of evidence supports
--     (§9 reuse; evidence is never duplicated to appear under another area).
--   • audit_exceptions — deviations/findings raised on a procedure (§12); a
--     carried-forward exception feeds Completion (SA-8).
--
-- SECURITY — engagement child data, same assignment-based access as the shell
-- and the SA-2..SA-4 tables: members SELECT, only leads (EP/manager)
-- INSERT/UPDATE/DELETE. ENABLE (not FORCE) RLS so the migrator-owned SECURITY
-- DEFINER helpers bypass; hsdg_app is never the owner. No new permission slug
-- (endpoints reuse engagement.read / engagement.manage; RLS gates).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── §11 area-detail overlay on the generated work area ─────────────────────
ALTER TABLE hsdg.audit_work_areas
  ADD COLUMN owner_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN reviewer_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN risk_level           text CHECK (risk_level IS NULL OR risk_level IN
                                     ('low','moderate','high','significant')),
  ADD COLUMN materiality          numeric(18,2) CHECK (materiality IS NULL OR materiality >= 0),
  ADD COLUMN due_date             date,
  ADD COLUMN financial_current    numeric(18,2),
  ADD COLUMN financial_prior      numeric(18,2),
  ADD COLUMN financial_source     text,
  ADD COLUMN conclusion           text,
  ADD COLUMN conclusion_state     text NOT NULL DEFAULT 'draft'
                                     CHECK (conclusion_state IN ('draft','submitted')),
  ADD COLUMN detail_version       integer NOT NULL DEFAULT 1;

-- ── Procedures (§12/§13) ──────────────────────────────────────────────────
CREATE TABLE hsdg.audit_procedures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Home area the procedure was created under (§11). Additional areas it also
  -- supports are in audit_procedure_areas (§14 reuse).
  work_area_id          uuid NOT NULL REFERENCES hsdg.audit_work_areas (id) ON DELETE CASCADE,
  procedure_ref         text NOT NULL CHECK (length(trim(procedure_ref)) > 0),
  title                 text NOT NULL CHECK (length(trim(title)) > 0),
  objective             text,
  -- Multi-select assertion set (§13); every element must be in the canonical set.
  assertions            text[] NOT NULL DEFAULT '{}' CHECK (assertions <@ ARRAY[
                          'existence','occurrence','completeness','accuracy','valuation',
                          'rights_and_obligations','cutoff','classification',
                          'presentation_and_disclosure']::text[]),
  -- The risk this procedure responds to, when a risk response (§22 two-way nav).
  risk_id               uuid REFERENCES hsdg.audit_risks (id) ON DELETE SET NULL,
  population            text,
  sampling_method       text CHECK (sampling_method IS NULL OR sampling_method IN
                          ('random','systematic','judgemental','monetary_unit','haphazard','other')),
  sample_size           integer CHECK (sample_size IS NULL OR sample_size >= 0),
  owner_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewer_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  due_date              date,
  expected_evidence     text,
  conclusion            text,
  state                 text NOT NULL DEFAULT 'not_started' CHECK (state IN
                          ('not_started','in_progress','ready_for_review','returned','complete')),
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Procedure ref is unique within the engagement (§13).
  UNIQUE (engagement_id, procedure_ref)
);
CREATE INDEX audit_procedures_instance_idx ON hsdg.audit_procedures (workflow_instance_id);
CREATE INDEX audit_procedures_engagement_idx ON hsdg.audit_procedures (engagement_id);
CREATE INDEX audit_procedures_area_idx ON hsdg.audit_procedures (work_area_id);
CREATE INDEX audit_procedures_risk_idx ON hsdg.audit_procedures (risk_id);
CREATE TRIGGER audit_procedures_set_updated_at
  BEFORE UPDATE ON hsdg.audit_procedures
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Additional areas a procedure supports (§14 cross-referencing/reuse) ────
CREATE TABLE hsdg.audit_procedure_areas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id  uuid NOT NULL REFERENCES hsdg.audit_procedures (id) ON DELETE CASCADE,
  work_area_id  uuid NOT NULL REFERENCES hsdg.audit_work_areas (id) ON DELETE CASCADE,
  engagement_id uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (procedure_id, work_area_id)
);
CREATE INDEX audit_procedure_areas_area_idx ON hsdg.audit_procedure_areas (work_area_id);
CREATE INDEX audit_procedure_areas_engagement_idx ON hsdg.audit_procedure_areas (engagement_id);

-- ── Evidence (engagement-level, reusable) (§9, §12) ────────────────────────
CREATE TABLE hsdg.audit_evidence (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  title                 text NOT NULL CHECK (length(trim(title)) > 0),
  kind                  text NOT NULL DEFAULT 'document' CHECK (kind IN
                          ('document','confirmation','analysis','external','recalculation',
                           'observation','inquiry','other')),
  -- Optional link to a DHVAJ document (M365/SharePoint metadata); kept if the doc goes.
  document_id           uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  note                  text,
  added_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_evidence_instance_idx ON hsdg.audit_evidence (workflow_instance_id);
CREATE INDEX audit_evidence_engagement_idx ON hsdg.audit_evidence (engagement_id);
CREATE TRIGGER audit_evidence_set_updated_at
  BEFORE UPDATE ON hsdg.audit_evidence
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Which procedures a piece of evidence supports (§9 reuse) ───────────────
CREATE TABLE hsdg.audit_evidence_procedures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id   uuid NOT NULL REFERENCES hsdg.audit_evidence (id) ON DELETE CASCADE,
  procedure_id  uuid NOT NULL REFERENCES hsdg.audit_procedures (id) ON DELETE CASCADE,
  engagement_id uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_id, procedure_id)
);
CREATE INDEX audit_evidence_procedures_procedure_idx
  ON hsdg.audit_evidence_procedures (procedure_id);
CREATE INDEX audit_evidence_procedures_engagement_idx
  ON hsdg.audit_evidence_procedures (engagement_id);

-- ── Exceptions raised on a procedure (§12) ─────────────────────────────────
CREATE TABLE hsdg.audit_exceptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id          uuid NOT NULL REFERENCES hsdg.audit_procedures (id) ON DELETE CASCADE,
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  description           text NOT NULL CHECK (length(trim(description)) > 0),
  severity              text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN
                          ('open','resolved','carried_forward')),
  resolution            text,
  raised_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_exceptions_procedure_idx ON hsdg.audit_exceptions (procedure_id);
CREATE INDEX audit_exceptions_engagement_idx ON hsdg.audit_exceptions (engagement_id);
CREATE TRIGGER audit_exceptions_set_updated_at
  BEFORE UPDATE ON hsdg.audit_exceptions
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (mirrors service_workflow_instances) ────────────────
ALTER TABLE hsdg.audit_procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_procedures_select ON hsdg.audit_procedures
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_procedures_insert ON hsdg.audit_procedures
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_procedures_update ON hsdg.audit_procedures
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_procedures_delete ON hsdg.audit_procedures
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_procedure_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_procedure_areas_select ON hsdg.audit_procedure_areas
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_procedure_areas_insert ON hsdg.audit_procedure_areas
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_procedure_areas_delete ON hsdg.audit_procedure_areas
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_evidence_select ON hsdg.audit_evidence
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_evidence_insert ON hsdg.audit_evidence
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_evidence_update ON hsdg.audit_evidence
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_evidence_delete ON hsdg.audit_evidence
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_evidence_procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_evidence_procedures_select ON hsdg.audit_evidence_procedures
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_evidence_procedures_insert ON hsdg.audit_evidence_procedures
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_evidence_procedures_delete ON hsdg.audit_evidence_procedures
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_exceptions_select ON hsdg.audit_exceptions
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_exceptions_insert ON hsdg.audit_exceptions
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_exceptions_update ON hsdg.audit_exceptions
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_exceptions_delete ON hsdg.audit_exceptions
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_exceptions CASCADE;
DROP TABLE IF EXISTS hsdg.audit_evidence_procedures CASCADE;
DROP TABLE IF EXISTS hsdg.audit_evidence CASCADE;
DROP TABLE IF EXISTS hsdg.audit_procedure_areas CASCADE;
DROP TABLE IF EXISTS hsdg.audit_procedures CASCADE;
ALTER TABLE hsdg.audit_work_areas
  DROP COLUMN IF EXISTS owner_employee_id,
  DROP COLUMN IF EXISTS reviewer_employee_id,
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS materiality,
  DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS financial_current,
  DROP COLUMN IF EXISTS financial_prior,
  DROP COLUMN IF EXISTS financial_source,
  DROP COLUMN IF EXISTS conclusion,
  DROP COLUMN IF EXISTS conclusion_state,
  DROP COLUMN IF EXISTS detail_version;
