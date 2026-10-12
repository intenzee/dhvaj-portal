-- ─────────────────────────────────────────────────────────────────────────
-- Engagement Restructure · Foundation (spec "Engagement Restructure, GST
-- Workspace & Compliance Calendar", Changes 1, 2, 4 schema + the CBDT hot-fix)
--
-- Every engagement gets a KIND — statutory_audit, compliance or assignment.
-- A Compliance engagement is one standing engagement per entity whose years in
-- scope live in compliance_engagement_years; it is made of six STREAMS (GST,
-- TDS, Income Tax, ROC, Bookkeeping, MIS) instead of the 51-service catalogue.
--
-- ADDITIVE ONLY. Nothing is dropped; the old per-engagement compliance unique
-- stays until P5. The one-open-compliance-per-entity index is created by the
-- data migration (after per-FY engagements are merged), not here.
--
--   1. engagements.kind (+ 'merged' status, merged_into_id), SA/CR/AS codes,
--      kind derived on insert when the caller does not state it
--   2. compliance_engagement_years
--   3. engagement_independence_checks (s.144 / 44AB outcomes + acknowledgements)
--   4. services.stream + six STREAM_* services; folded services carry their
--      stream and folded_into_service_id, are deactivated, and their curated
--      components are re-parented to the stream service
--   5. kind ↔ service trigger on engagement_services
--   6. registration_compliance_profiles (effective-dated, per registration / PAN)
--   7. compliance_rule_versions: schedule / overrides / filter / event / variants
--   8. compliance_instances: registration, stream line, period, section,
--      workflow_status (status kept and derived)
--   9. CBDT extension hot-fix (tax audit → 21 Oct 2026; audit-case ITR → 21 Nov)
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- Backfills and seeds read/write RLS-forced tables as their owner: lift FORCE
-- for the duration of the migration (restored at the end).
ALTER TABLE hsdg.service_lines NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions NO FORCE ROW LEVEL SECURITY;


-- ── 1. Engagement kind ─────────────────────────────────────────────────────
ALTER TABLE hsdg.engagements
  ADD COLUMN kind text CHECK (kind IN ('statutory_audit','compliance','assignment')),
  ADD COLUMN merged_into_id uuid REFERENCES hsdg.engagements (id) ON DELETE RESTRICT,
  ADD CONSTRAINT engagements_merged_target CHECK (
    (status = 'merged') = (merged_into_id IS NOT NULL) AND (merged_into_id IS NULL OR merged_into_id <> id)
  ) NOT VALID;

ALTER TABLE hsdg.engagements DROP CONSTRAINT engagements_status_check;
ALTER TABLE hsdg.engagements ADD CONSTRAINT engagements_status_check CHECK (status IN
  ('prospect','pending_acceptance','accepted','active','on_hold',
   'completed','closed','declined','withdrawn','cancelled','merged'));
ALTER TABLE hsdg.engagements VALIDATE CONSTRAINT engagements_merged_target;

CREATE INDEX engagements_kind_idx ON hsdg.engagements (kind);
CREATE INDEX engagements_merged_into_idx ON hsdg.engagements (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- ── 4 (first, kind derivation needs it). services.stream + stream services ──
ALTER TABLE hsdg.services
  ADD COLUMN stream text CHECK (stream IN ('gst','tds','income_tax','roc','bookkeeping','mis')),
  ADD COLUMN folded_into_service_id uuid REFERENCES hsdg.services (id) ON DELETE RESTRICT,
  ADD CONSTRAINT services_fold_has_stream CHECK (folded_into_service_id IS NULL OR stream IS NOT NULL);
CREATE INDEX services_stream_idx ON hsdg.services (stream) WHERE stream IS NOT NULL;

-- A stream service is the one live service per stream (folded_into IS NULL).
CREATE UNIQUE INDEX services_one_live_stream
  ON hsdg.services (stream) WHERE stream IS NOT NULL AND folded_into_service_id IS NULL;


INSERT INTO hsdg.services
  (service_line_id, code, name, description, required_review_model_id, workflow_family_id,
   default_recurrence, stream)
SELECT sl.id, v.code, v.name, v.description, rm.id, wf.id, v.recurrence, v.stream
FROM (VALUES
  ('STREAM_GST',         'GST',          'GST',
   'All GST work for each GSTIN: monthly / quarterly returns, annual return, e-invoice & e-way bill, and other GST work (registration, refunds, notices, appeals, advisory).',
   'GST',      'monthly', 'gst'),
  ('STREAM_TDS',         'TDS / TCS',    'TDS',
   'TDS and TCS for each TAN: monthly challans, quarterly statements, certificates.',
   'TAX',      'monthly', 'tds'),
  ('STREAM_INCOME_TAX',  'Income Tax',   'INCOME_TAX',
   'Income tax on the PAN: advance tax, return of income, belated / revised returns and other income-tax work (assessments, appeals, advisory).',
   'TAX',      'annual',  'income_tax'),
  ('STREAM_ROC',         'ROC / MCA',    'ROC',
   'Company / LLP law compliance on the CIN or LLPIN: AGM, annual filings, event filings, board meetings.',
   'ROC',      'annual',  'roc'),
  ('STREAM_BOOKKEEPING', 'Bookkeeping',  'BOOKKEEPING',
   'Monthly accounting: data received, bank reconciliation, ledger scrutiny, GST/TDS reconciliation, books closed; FS finalisation.',
   'ACCOUNTS', 'monthly', 'bookkeeping'),
  ('STREAM_MIS',         'MIS',          'MIS',
   'Monthly MIS pack, variance commentary and virtual-CFO support.',
   'ACCOUNTS', 'monthly', 'mis')
) AS v(code, name, _tab, description, line_code, recurrence, stream)
JOIN hsdg.service_lines sl ON sl.code = v.line_code
JOIN hsdg.review_models rm ON rm.slug = 'manager_review'
JOIN hsdg.workflow_families wf ON wf.slug = 'recurring_compliance_workflow'
ON CONFLICT (code) DO UPDATE SET stream = EXCLUDED.stream, is_active = true,
  folded_into_service_id = NULL;

-- Fold the old services into their stream (history keeps its service rows).
WITH fold(code, stream) AS (VALUES
  ('GST_MONTHLY','gst'), ('GST_ANNUAL','gst'), ('GST_EINV_EWAY','gst'),
  ('GST_REGISTRATION','gst'), ('GST_REFUND','gst'), ('GST_ASSESSMENT','gst'),
  ('GST_APPEAL','gst'), ('GST_ADVISORY','gst'),
  ('TDS_COMPLIANCE','tds'), ('TCS_COMPLIANCE','tds'),
  ('ITR_FILING','income_tax'), ('ADVANCE_TAX','income_tax'), ('TAX_ASSESSMENT','income_tax'),
  ('TAX_APPEAL','income_tax'), ('ITAT_REP','income_tax'), ('TAX_ADVISORY','income_tax'),
  ('TAX_PLANNING','income_tax'), ('INTL_TAX','income_tax'),
  ('ROC_ANNUAL','roc'), ('ROC_EVENT','roc'), ('GOVERNANCE','roc'), ('INCORPORATION','roc'),
  ('BOOKKEEPING','bookkeeping'), ('FS_FINALISATION','bookkeeping'),
  ('MIS_REPORTING','mis'), ('VIRTUAL_CFO','mis')
)
UPDATE hsdg.services s
   SET stream = f.stream,
       folded_into_service_id = live.id,
       is_active = false
  FROM fold f
  JOIN hsdg.services live ON live.stream = f.stream AND live.code LIKE 'STREAM\_%'
 WHERE s.code = f.code;

-- Re-parent the curated components of folded services to the stream service.
-- Component codes are globally unique, so engagement_components and
-- component_instances keep resolving by id; the enforcement trigger below
-- accepts a folded engagement-service's components via folded_into.
ALTER TABLE hsdg.service_components ADD COLUMN folded_from_service_id uuid
  REFERENCES hsdg.services (id) ON DELETE RESTRICT;
UPDATE hsdg.service_components sc
   SET folded_from_service_id = sc.service_id,
       service_id = s.folded_into_service_id
  FROM hsdg.services s
 WHERE sc.service_id = s.id AND s.folded_into_service_id IS NOT NULL;

-- ICFR (IFC) is a section of the audit file; test rows are deactivated.
UPDATE hsdg.services SET is_active = false
 WHERE code IN ('IFC','AUD_704588','DUP_704386','MOV_704603','VER_704429','DD_704340','OTH_704566');


-- A component belongs to an engagement-service when it is the service's own,
-- or the stream service the engagement-service's (folded) service became.
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_component_service() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.engagement_service_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM hsdg.service_components sc
      JOIN hsdg.engagement_services es ON es.id = NEW.engagement_service_id
      JOIN hsdg.services s ON s.id = es.service_id
      WHERE sc.id = NEW.service_component_id
        AND es.engagement_id = NEW.engagement_id
        AND sc.service_id IN (s.id, s.folded_into_service_id)
    ) THEN
      RAISE EXCEPTION 'service_component must belong to the engagement-service''s service.';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM hsdg.service_components sc
      JOIN hsdg.engagements e ON e.id = NEW.engagement_id
      JOIN hsdg.services s ON s.id = e.service_id
      WHERE sc.id = NEW.service_component_id
        AND sc.service_id IN (s.id, s.folded_into_service_id)
    ) THEN
      RAISE EXCEPTION 'service_component must belong to the engagement''s service.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Kind of an engagement whose caller did not state one, from its services.
CREATE OR REPLACE FUNCTION hsdg.engagement_kind_for_service(svc_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT CASE
           WHEN s.code = 'STAT_AUDIT' THEN 'statutory_audit'
           WHEN s.stream IS NOT NULL  THEN 'compliance'
           ELSE 'assignment'
         END
  FROM hsdg.services s WHERE s.id = svc_id
$$;

CREATE OR REPLACE FUNCTION hsdg.engagements_default_kind_and_code() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  prefix text;
BEGIN
  IF NEW.kind IS NULL THEN
    NEW.kind := hsdg.engagement_kind_for_service(NEW.service_id);
  END IF;
  -- Default codes (ENG00123) become SA/00123, CR/00123, AS/00123 — same
  -- sequence number, so codes stay unique and ordered. Explicit codes stand.
  IF NEW.engagement_code ~ '^ENG[0-9]+$' THEN
    prefix := CASE NEW.kind WHEN 'statutory_audit' THEN 'SA' WHEN 'compliance' THEN 'CR' ELSE 'AS' END;
    NEW.engagement_code := prefix || '/' || substring(NEW.engagement_code FROM 4);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagements_default_kind_and_code
  BEFORE INSERT ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagements_default_kind_and_code();

-- Backfill (spec "Migration of existing data" step 1): any STAT_AUDIT line →
-- statutory_audit; every line folds into a stream → compliance; else assignment.
-- Mixed audit + ITR engagements stay statutory_audit until the split migration.
UPDATE hsdg.engagements e SET kind = CASE
    WHEN EXISTS (SELECT 1 FROM hsdg.engagement_services es JOIN hsdg.services s ON s.id = es.service_id
                  WHERE es.engagement_id = e.id AND s.code = 'STAT_AUDIT')
      OR (SELECT code FROM hsdg.services WHERE id = e.service_id) = 'STAT_AUDIT'
      THEN 'statutory_audit'
    WHEN NOT EXISTS (SELECT 1 FROM hsdg.engagement_services es JOIN hsdg.services s ON s.id = es.service_id
                      WHERE es.engagement_id = e.id AND s.stream IS NULL)
     AND (SELECT stream FROM hsdg.services WHERE id = e.service_id) IS NOT NULL
      THEN 'compliance'
    ELSE 'assignment'
  END;
ALTER TABLE hsdg.engagements ALTER COLUMN kind SET NOT NULL;

-- ── 5. Kind ↔ service guard on engagement_services ─────────────────────────
-- statutory_audit holds STAT_AUDIT only; compliance holds stream services only
-- (live STREAM_* or a folded legacy line); assignment holds neither.
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_service_kind() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  eng_kind text;
  svc_code text;
  svc_stream text;
BEGIN
  SELECT kind INTO eng_kind FROM hsdg.engagements WHERE id = NEW.engagement_id;
  SELECT code, stream INTO svc_code, svc_stream FROM hsdg.services WHERE id = NEW.service_id;
  IF eng_kind = 'statutory_audit' AND svc_code <> 'STAT_AUDIT' THEN
    RAISE EXCEPTION 'A Statutory Audit engagement may only hold the STAT_AUDIT service (got %).', svc_code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'engagement_services_kind';
  ELSIF eng_kind = 'compliance' AND svc_stream IS NULL THEN
    RAISE EXCEPTION 'A Compliance engagement may only hold stream services (got %).', svc_code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'engagement_services_kind';
  ELSIF eng_kind = 'assignment' AND (svc_code = 'STAT_AUDIT' OR svc_stream IS NOT NULL) THEN
    RAISE EXCEPTION 'An assignment cannot hold % — use a Statutory Audit or Compliance engagement.', svc_code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'engagement_services_kind';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagement_services_enforce_kind
  BEFORE INSERT OR UPDATE OF service_id, engagement_id ON hsdg.engagement_services
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_service_kind();

-- ── 2. Compliance engagement years ─────────────────────────────────────────
CREATE TABLE hsdg.compliance_engagement_years (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  financial_year         text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  streams                text[] NOT NULL DEFAULT '{}'
                           CHECK (streams <@ ARRAY['gst','tds','income_tax','roc','bookkeeping','mis']::text[]),
  -- {stream: [registration id, …]} — the registrations each stream runs on this
  -- year (GSTINs for GST, TANs for TDS, CIN/LLPIN for ROC; PAN / entity streams
  -- carry an empty list).
  stream_registrations   jsonb NOT NULL DEFAULT '{}'::jsonb
                           CHECK (jsonb_typeof(stream_registrations) = 'object'),
  fee_amount             numeric(14,2) CHECK (fee_amount IS NULL OR fee_amount >= 0),
  billing_model          text CHECK (billing_model IS NULL OR billing_model IN
                           ('fixed_fee','time_and_material','retainer','milestone','pro_bono','not_billed')),
  -- {stream: hours} — Activity → Time budget vs actual.
  budget_hours           jsonb NOT NULL DEFAULT '{}'::jsonb
                           CHECK (jsonb_typeof(budget_hours) = 'object'),
  engagement_letter_ref  text,
  engagement_letter_date date,
  -- s.144 board / audit-committee approval for permitted non-audit services.
  s144_approval_ref      text,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at              timestamptz,
  closed_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_engagement_years_unique UNIQUE (engagement_id, financial_year),
  CONSTRAINT compliance_engagement_years_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX compliance_engagement_years_fy_idx ON hsdg.compliance_engagement_years (financial_year);
CREATE INDEX compliance_engagement_years_streams_idx
  ON hsdg.compliance_engagement_years USING gin (streams);
CREATE TRIGGER compliance_engagement_years_set_updated_at BEFORE UPDATE ON hsdg.compliance_engagement_years
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Years belong to Compliance engagements only.
CREATE OR REPLACE FUNCTION hsdg.enforce_compliance_year_kind() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM hsdg.engagements WHERE id = NEW.engagement_id) <> 'compliance' THEN
    RAISE EXCEPTION 'Years in scope belong to Compliance engagements only.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'compliance_engagement_years_kind';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER compliance_engagement_years_enforce_kind
  BEFORE INSERT OR UPDATE OF engagement_id ON hsdg.compliance_engagement_years
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_compliance_year_kind();

REVOKE DELETE ON hsdg.compliance_engagement_years FROM hsdg_app;
ALTER TABLE hsdg.compliance_engagement_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_engagement_years_select ON hsdg.compliance_engagement_years
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY compliance_engagement_years_insert ON hsdg.compliance_engagement_years
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY compliance_engagement_years_update ON hsdg.compliance_engagement_years
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── 3. Independence checks (outcomes + partner acknowledgements) ───────────
CREATE TABLE hsdg.engagement_independence_checks (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id               uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  rule_code                   text NOT NULL CHECK (rule_code ~ '^[A-Z0-9_]{2,60}$'),
  outcome                     text NOT NULL CHECK (outcome IN ('pass','warn','block')),
  message                     text NOT NULL,
  financial_year              text,
  acknowledged_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  acknowledged_at             timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_independence_ack CHECK (
    (acknowledged_at IS NULL) = (acknowledged_by_employee_id IS NULL)
  )
);
CREATE INDEX engagement_independence_checks_engagement_idx
  ON hsdg.engagement_independence_checks (engagement_id, created_at DESC);
REVOKE UPDATE, DELETE ON hsdg.engagement_independence_checks FROM hsdg_app;
ALTER TABLE hsdg.engagement_independence_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_independence_checks FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_independence_checks_select ON hsdg.engagement_independence_checks
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_independence_checks_insert ON hsdg.engagement_independence_checks
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── 6. Registration compliance profiles ────────────────────────────────────
-- One effective-dated profile per registration (GSTIN / TAN / CIN / LLPIN) or
-- per PAN (the entity itself — PAN lives on hsdg.entities, so registration_id
-- is NULL for scope 'pan'). Typed columns for what conditions test most; the
-- rest in attributes, validated per scope by the API.
CREATE TABLE hsdg.registration_compliance_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id              uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  registration_id        uuid REFERENCES hsdg.entity_registrations (id) ON DELETE CASCADE,
  scope                  text NOT NULL CHECK (scope IN ('gstin','tan','pan','cin','llpin')),
  effective_from         date NOT NULL,
  effective_to           date,
  gst_scheme             text CHECK (gst_scheme IS NULL OR gst_scheme IN
                           ('regular','qrmp','composition','isd','gst_tds','eco_tcs','nrtp','oidar','uin')),
  qrmp_category          text CHECK (qrmp_category IS NULL OR qrmp_category IN ('X','Y')),
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_compliance_profiles_scope CHECK ((scope = 'pan') = (registration_id IS NULL)),
  CONSTRAINT registration_compliance_profiles_gst_only CHECK (
    scope = 'gstin' OR (gst_scheme IS NULL AND qrmp_category IS NULL)
  ),
  CONSTRAINT registration_compliance_profiles_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX registration_compliance_profiles_unique
  ON hsdg.registration_compliance_profiles (entity_id, scope, registration_id, effective_from)
  NULLS NOT DISTINCT;
CREATE INDEX registration_compliance_profiles_reg_idx
  ON hsdg.registration_compliance_profiles (registration_id, effective_from DESC);
CREATE TRIGGER registration_compliance_profiles_set_updated_at
  BEFORE UPDATE ON hsdg.registration_compliance_profiles
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Read: whoever may see the client (office / firm-wide) or works on any of its
-- engagements. Write: firm-wide, or a lead of one of its engagements.
CREATE OR REPLACE FUNCTION hsdg.can_read_entity_compliance(ent_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_firmwide()
      OR EXISTS (SELECT 1 FROM hsdg.entities e
                  WHERE e.id = ent_id
                    AND (hsdg.ctx_is_business_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
      OR EXISTS (SELECT 1 FROM hsdg.engagements g
                  WHERE g.entity_id = ent_id AND hsdg.is_engagement_member(g.id))
$$;
CREATE OR REPLACE FUNCTION hsdg.can_manage_entity_compliance(ent_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_firmwide()
      OR EXISTS (SELECT 1 FROM hsdg.engagements g
                  WHERE g.entity_id = ent_id
                    AND g.status NOT IN ('closed','merged','cancelled','declined','withdrawn')
                    AND hsdg.ctx_employee_id() IS NOT NULL
                    AND (g.engagement_partner_id = hsdg.ctx_employee_id()
                         OR g.engagement_manager_id = hsdg.ctx_employee_id()))
$$;

REVOKE DELETE ON hsdg.registration_compliance_profiles FROM hsdg_app;
ALTER TABLE hsdg.registration_compliance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.registration_compliance_profiles FORCE  ROW LEVEL SECURITY;
CREATE POLICY registration_compliance_profiles_select ON hsdg.registration_compliance_profiles
  FOR SELECT USING (hsdg.can_read_entity_compliance(entity_id));
CREATE POLICY registration_compliance_profiles_insert ON hsdg.registration_compliance_profiles
  FOR INSERT WITH CHECK (hsdg.can_manage_entity_compliance(entity_id));
CREATE POLICY registration_compliance_profiles_update ON hsdg.registration_compliance_profiles
  FOR UPDATE USING (hsdg.can_manage_entity_compliance(entity_id))
  WITH CHECK (hsdg.can_manage_entity_compliance(entity_id));

-- ── 7. Rule engine: what the Recurring Summary sheet needs ─────────────────
ALTER TABLE hsdg.compliance_rules DROP CONSTRAINT compliance_rules_category_check;
ALTER TABLE hsdg.compliance_rules ADD CONSTRAINT compliance_rules_category_check
  CHECK (category IN ('income_tax','gst','tds','roc','audit','bookkeeping','mis','other'));

ALTER TABLE hsdg.compliance_rule_versions
  DROP CONSTRAINT compliance_rule_versions_calculation_basis_check,
  DROP CONSTRAINT compliance_rule_versions_fixed;
ALTER TABLE hsdg.compliance_rule_versions
  ADD CONSTRAINT compliance_rule_versions_calculation_basis_check CHECK (calculation_basis IN
    ('fy_end','period_end','period_start','month_end','fixed_date','event_date','schedule')),
  ADD CONSTRAINT compliance_rule_versions_fixed CHECK (
    (calculation_basis = 'fixed_date' AND fixed_month IS NOT NULL AND fixed_day IS NOT NULL)
    OR (calculation_basis <> 'fixed_date' AND fixed_month IS NULL AND fixed_day IS NULL)
  ),
  ADD COLUMN stream text CHECK (stream IS NULL OR stream IN
    ('gst','tds','income_tax','roc','bookkeeping','mis')),
  -- Which registration the rule runs on (one instance per registration).
  ADD COLUMN registration_scope text CHECK (registration_scope IS NULL OR registration_scope IN
    ('gstin','tan','pan','cin','llpin','entity','din')),
  ADD COLUMN frequency text CHECK (frequency IS NULL OR frequency IN
    ('monthly','quarterly','half_yearly','annual','triennial','event','on_demand')),
  -- The form name valid for this version (26Q → Form 140 from 1 Apr 2026).
  ADD COLUMN form_label text,
  -- GST month workspace section: outward / inward / summary / annual.
  ADD COLUMN section text CHECK (section IS NULL OR section IN ('outward','inward','summary','annual')),
  -- basis 'schedule': [{"period":"Q1","month":7,"day":31,"year_offset":0}, …]
  -- period = M01..M12 (FY month) / Q1..Q4 / H1..H2 / FY; month+day are the due
  -- date; year_offset counts calendar years from the FY's start year.
  ADD COLUMN schedule jsonb CHECK (schedule IS NULL OR jsonb_typeof(schedule) = 'array'),
  -- {"03":{"month":4,"day":30}} — calendar-month (MM) exceptions to a monthly rule.
  ADD COLUMN period_overrides jsonb CHECK (period_overrides IS NULL OR jsonb_typeof(period_overrides) = 'object'),
  -- ["M1","M2"] — only those months of each quarter (IFF, PMT-06).
  ADD COLUMN period_filter text[],
  -- event_date basis: agm / appointment / allotment / registration / …
  ADD COLUMN event_type text,
  -- {"basis":"fy_end","offset_months":6,"offset_days":0} — assumed event date
  -- (AGM on 30 Sep) so the item shows before the event is recorded.
  ADD COLUMN provisional_event_rule jsonb,
  -- [{"when":{condition},"set":{"offset_days":24}}, …] — first match overrides
  -- the version's own encoding (QRMP X/Y, OPC AOC-4 180 days).
  ADD COLUMN variants jsonb CHECK (variants IS NULL OR jsonb_typeof(variants) = 'array'),
  ADD COLUMN is_optional boolean NOT NULL DEFAULT false,
  ADD COLUMN late_fee_note text,
  ADD COLUMN verification text NOT NULL DEFAULT 'verified' CHECK (verification IN ('verified','verify')),
  ADD COLUMN source_ref text,
  ADD CONSTRAINT compliance_rule_versions_schedule CHECK (
    (calculation_basis = 'schedule') = (schedule IS NOT NULL)
  );

-- A partner confirms a "verify" rule on /compliance/rules — append-only
-- versions cannot be updated, so confirmations are their own log.
CREATE TABLE hsdg.compliance_rule_verifications (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_rule_version_id uuid NOT NULL REFERENCES hsdg.compliance_rule_versions (id) ON DELETE CASCADE,
  verified_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  verified_by_user_id        uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  note                       text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_rule_verifications_unique UNIQUE (compliance_rule_version_id)
);
REVOKE UPDATE, DELETE ON hsdg.compliance_rule_verifications FROM hsdg_app;
ALTER TABLE hsdg.compliance_rule_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_verifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_rule_verifications_read ON hsdg.compliance_rule_verifications
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY compliance_rule_verifications_insert ON hsdg.compliance_rule_verifications
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

-- Recorded events that event-based rules run from (AGM date per year, auditor
-- appointment, allotment …). The existing "Record event" flow writes here too.
CREATE TABLE hsdg.compliance_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  registration_id        uuid REFERENCES hsdg.entity_registrations (id) ON DELETE SET NULL,
  event_type             text NOT NULL CHECK (event_type ~ '^[a-z0-9_]{2,40}$'),
  financial_year         text CHECK (financial_year IS NULL OR financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  event_date             date NOT NULL,
  notes                  text,
  recorded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_events_engagement_idx
  ON hsdg.compliance_events (engagement_id, event_type, financial_year);
REVOKE UPDATE, DELETE ON hsdg.compliance_events FROM hsdg_app;
ALTER TABLE hsdg.compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_events_select ON hsdg.compliance_events
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY compliance_events_insert ON hsdg.compliance_events
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── 8. Compliance instances: registration, stream line, period, section ────
ALTER TABLE hsdg.compliance_instances
  ADD COLUMN registration_id       uuid REFERENCES hsdg.entity_registrations (id) ON DELETE RESTRICT,
  ADD COLUMN engagement_service_id uuid REFERENCES hsdg.engagement_services (id) ON DELETE RESTRICT,
  ADD COLUMN financial_year        text CHECK (financial_year IS NULL OR financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  -- 'YYYY-MM' month · 'YYYY-YY:Q1' quarter · 'YYYY-YY:H1' half · 'YYYY-YY' year ·
  -- 'YYYY-YY:DIN:<din>' per-director triennial · 'EVT:<compliance_event id>'.
  ADD COLUMN period_key            text,
  ADD COLUMN period_start          date,
  ADD COLUMN period_end            date,
  ADD COLUMN section               text CHECK (section IS NULL OR section IN ('outward','inward','summary','annual')),
  ADD COLUMN workflow_status       text NOT NULL DEFAULT 'not_started' CHECK (workflow_status IN
    ('not_started','awaiting_data','in_preparation','in_review','ready_to_file','filed','not_applicable')),
  ADD COLUMN is_provisional        boolean NOT NULL DEFAULT false,
  ADD COLUMN is_optional           boolean NOT NULL DEFAULT false,
  ADD COLUMN compliance_event_id   uuid REFERENCES hsdg.compliance_events (id) ON DELETE SET NULL,
  ADD COLUMN profile_changed_at    timestamptz,
  ADD CONSTRAINT compliance_instances_period_range CHECK (
    period_end IS NULL OR period_start IS NULL OR period_end >= period_start
  );

UPDATE hsdg.compliance_instances SET workflow_status = CASE status
  WHEN 'completed' THEN 'filed' WHEN 'waived' THEN 'not_applicable' ELSE 'not_started' END;

-- One obligation per engagement + rule + registration + period (generator v2).
-- Partial: v1 rows (period_key NULL) keep compliance_instances_unique until P5.
CREATE UNIQUE INDEX compliance_instances_period_unique
  ON hsdg.compliance_instances (engagement_id, compliance_rule_id, registration_id, period_key)
  NULLS NOT DISTINCT WHERE period_key IS NOT NULL;
CREATE INDEX compliance_instances_stream_tree_idx
  ON hsdg.compliance_instances (engagement_id, financial_year, registration_id)
  WHERE period_key IS NOT NULL;
CREATE INDEX compliance_instances_registration_idx
  ON hsdg.compliance_instances (registration_id) WHERE registration_id IS NOT NULL;
CREATE INDEX compliance_instances_engagement_service_idx
  ON hsdg.compliance_instances (engagement_service_id) WHERE engagement_service_id IS NOT NULL;

-- status stays and is DERIVED from workflow_status (filed → completed,
-- not_applicable → waived, else open). Writers of the old status (complete /
-- waive / reopen endpoints) move workflow_status with it.
CREATE OR REPLACE FUNCTION hsdg.compliance_instances_sync_status() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workflow_status IS NOT DISTINCT FROM OLD.workflow_status
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.workflow_status := CASE NEW.status
      WHEN 'completed' THEN 'filed'
      WHEN 'waived'    THEN 'not_applicable'
      ELSE CASE WHEN OLD.workflow_status IN ('filed','not_applicable') THEN 'not_started'
                ELSE OLD.workflow_status END
    END;
  END IF;
  NEW.status := CASE NEW.workflow_status
    WHEN 'filed'          THEN 'completed'
    WHEN 'not_applicable' THEN 'waived'
    ELSE 'open'
  END;
  IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'open' THEN
    NEW.completed_at := NULL;
    NEW.completed_by_employee_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER compliance_instances_sync_status
  BEFORE INSERT OR UPDATE OF status, workflow_status ON hsdg.compliance_instances
  FOR EACH ROW EXECUTE FUNCTION hsdg.compliance_instances_sync_status();

-- ── 9. CBDT extension hot-fix (28 Sep 2026) ────────────────────────────────
-- Tax audit report AY 2026-27 → 21 Oct 2026; ITR for audit cases → 21 Nov 2026.
-- Form 3CEB (31 Oct) and the TP ITR (30 Nov) are NOT extended. Seeded on the
-- existing rules and applied to every open obligation whose computed date is
-- the original one; the calendar rebuild seeds the same on its new rules.

INSERT INTO hsdg.government_extensions
  (compliance_rule_id, original_due_date, revised_due_date, notification_reference,
   applicable_population, effective_date, notes)
SELECT r.id, v.orig::date, v.rev::date, 'CBDT Circular (28 Sep 2026)', v.pop, '2026-09-28'::date, v.note
FROM (VALUES
  ('TAX_AUDIT_44AB', '2026-09-30', '2026-10-21',
   'Assessees required to furnish the tax audit report u/s 44AB for AY 2026-27',
   'Tax audit report AY 2026-27 extended to 21 Oct 2026.'),
  ('ITR_FILING_DUE', '2026-10-31', '2026-11-21',
   'Assessees whose accounts are required to be audited (audit cases), AY 2026-27; not TP (3CEB) cases',
   'Return of income for audit cases AY 2026-27 extended to 21 Nov 2026.')
) AS v(code, orig, rev, pop, note)
JOIN hsdg.compliance_rules r ON r.code = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM hsdg.government_extensions ge
   WHERE ge.compliance_rule_id = r.id AND ge.original_due_date = v.orig::date
);

UPDATE hsdg.compliance_instances ci
   SET government_extension_id = ge.id
  FROM hsdg.government_extensions ge
 WHERE ge.compliance_rule_id = ci.compliance_rule_id
   AND ge.original_due_date = ci.statutory_deadline
   AND ge.notification_reference = 'CBDT Circular (28 Sep 2026)'
   AND ci.status = 'open'
   AND ci.government_extension_id IS NULL
   AND ci.statutory_deadline_override IS NULL;

ALTER TABLE hsdg.service_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions FORCE ROW LEVEL SECURITY;

-- Down Migration

-- Backfills and seeds read/write RLS-forced tables as their owner: lift FORCE
-- for the duration of the migration (restored at the end).
ALTER TABLE hsdg.service_lines NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.compliance_instances SET government_extension_id = NULL
 WHERE government_extension_id IN (
   SELECT id FROM hsdg.government_extensions WHERE notification_reference = 'CBDT Circular (28 Sep 2026)');
DELETE FROM hsdg.government_extensions WHERE notification_reference = 'CBDT Circular (28 Sep 2026)';

DROP TRIGGER IF EXISTS compliance_instances_sync_status ON hsdg.compliance_instances;
DROP FUNCTION IF EXISTS hsdg.compliance_instances_sync_status();
DROP INDEX IF EXISTS hsdg.compliance_instances_engagement_service_idx;
DROP INDEX IF EXISTS hsdg.compliance_instances_registration_idx;
DROP INDEX IF EXISTS hsdg.compliance_instances_stream_tree_idx;
DROP INDEX IF EXISTS hsdg.compliance_instances_period_unique;
ALTER TABLE hsdg.compliance_instances
  DROP CONSTRAINT IF EXISTS compliance_instances_period_range,
  DROP COLUMN IF EXISTS profile_changed_at,
  DROP COLUMN IF EXISTS compliance_event_id,
  DROP COLUMN IF EXISTS is_optional,
  DROP COLUMN IF EXISTS is_provisional,
  DROP COLUMN IF EXISTS workflow_status,
  DROP COLUMN IF EXISTS section,
  DROP COLUMN IF EXISTS period_end,
  DROP COLUMN IF EXISTS period_start,
  DROP COLUMN IF EXISTS period_key,
  DROP COLUMN IF EXISTS financial_year,
  DROP COLUMN IF EXISTS engagement_service_id,
  DROP COLUMN IF EXISTS registration_id;

DROP TABLE IF EXISTS hsdg.compliance_events CASCADE;
DROP TABLE IF EXISTS hsdg.compliance_rule_verifications CASCADE;

ALTER TABLE hsdg.compliance_rule_versions
  DROP CONSTRAINT IF EXISTS compliance_rule_versions_schedule,
  DROP COLUMN IF EXISTS source_ref,
  DROP COLUMN IF EXISTS verification,
  DROP COLUMN IF EXISTS late_fee_note,
  DROP COLUMN IF EXISTS is_optional,
  DROP COLUMN IF EXISTS variants,
  DROP COLUMN IF EXISTS provisional_event_rule,
  DROP COLUMN IF EXISTS event_type,
  DROP COLUMN IF EXISTS period_filter,
  DROP COLUMN IF EXISTS period_overrides,
  DROP COLUMN IF EXISTS schedule,
  DROP COLUMN IF EXISTS section,
  DROP COLUMN IF EXISTS form_label,
  DROP COLUMN IF EXISTS frequency,
  DROP COLUMN IF EXISTS registration_scope,
  DROP COLUMN IF EXISTS stream;
ALTER TABLE hsdg.compliance_rule_versions
  DROP CONSTRAINT compliance_rule_versions_calculation_basis_check,
  DROP CONSTRAINT compliance_rule_versions_fixed;
ALTER TABLE hsdg.compliance_rule_versions
  ADD CONSTRAINT compliance_rule_versions_calculation_basis_check CHECK (calculation_basis IN
    ('fy_end','period_end','period_start','month_end','fixed_date','event_date')),
  ADD CONSTRAINT compliance_rule_versions_fixed CHECK (
    (calculation_basis = 'fixed_date' AND fixed_month IS NOT NULL AND fixed_day IS NOT NULL)
    OR (calculation_basis <> 'fixed_date' AND fixed_month IS NULL AND fixed_day IS NULL)
  );
ALTER TABLE hsdg.compliance_rules DROP CONSTRAINT compliance_rules_category_check;
ALTER TABLE hsdg.compliance_rules ADD CONSTRAINT compliance_rules_category_check
  CHECK (category IN ('income_tax','gst','tds','roc','audit','other'));

DROP TABLE IF EXISTS hsdg.registration_compliance_profiles CASCADE;
DROP FUNCTION IF EXISTS hsdg.can_manage_entity_compliance(uuid);
DROP FUNCTION IF EXISTS hsdg.can_read_entity_compliance(uuid);
DROP TABLE IF EXISTS hsdg.engagement_independence_checks CASCADE;
DROP TABLE IF EXISTS hsdg.compliance_engagement_years CASCADE;
DROP FUNCTION IF EXISTS hsdg.enforce_compliance_year_kind();

DROP TRIGGER IF EXISTS engagement_services_enforce_kind ON hsdg.engagement_services;
DROP FUNCTION IF EXISTS hsdg.enforce_engagement_service_kind();
DROP TRIGGER IF EXISTS engagements_default_kind_and_code ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.engagements_default_kind_and_code();
DROP FUNCTION IF EXISTS hsdg.engagement_kind_for_service(uuid);

-- Restore the component-service guard to its pre-fold form.
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_component_service() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.engagement_service_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM hsdg.service_components sc
      JOIN hsdg.engagement_services es ON es.service_id = sc.service_id
      WHERE sc.id = NEW.service_component_id
        AND es.id = NEW.engagement_service_id
        AND es.engagement_id = NEW.engagement_id
    ) THEN
      RAISE EXCEPTION 'service_component must belong to the engagement-service''s service.';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM hsdg.service_components sc
      JOIN hsdg.engagements e ON e.service_id = sc.service_id
      WHERE sc.id = NEW.service_component_id AND e.id = NEW.engagement_id
    ) THEN
      RAISE EXCEPTION 'service_component must belong to the engagement''s service.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Components go back to the exact service they were folded from.
UPDATE hsdg.service_components
   SET service_id = folded_from_service_id
 WHERE folded_from_service_id IS NOT NULL;
ALTER TABLE hsdg.service_components DROP COLUMN folded_from_service_id;
UPDATE hsdg.services SET is_active = true, stream = NULL, folded_into_service_id = NULL
 WHERE folded_into_service_id IS NOT NULL;
UPDATE hsdg.services SET is_active = true
 WHERE code IN ('IFC','AUD_704588','DUP_704386','MOV_704603','DD_704340','OTH_704566');
-- Stream services go unless something was created on them after the up.
DELETE FROM hsdg.services
 WHERE code LIKE 'STREAM\_%'
   AND NOT EXISTS (SELECT 1 FROM hsdg.service_components sc WHERE sc.service_id = hsdg.services.id)
   AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_services es WHERE es.service_id = hsdg.services.id)
   AND NOT EXISTS (SELECT 1 FROM hsdg.engagements e WHERE e.service_id = hsdg.services.id)
   AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_rules r WHERE r.service_id = hsdg.services.id);
DROP INDEX IF EXISTS hsdg.services_one_live_stream;
DROP INDEX IF EXISTS hsdg.services_stream_idx;
ALTER TABLE hsdg.services
  DROP CONSTRAINT IF EXISTS services_fold_has_stream,
  DROP COLUMN IF EXISTS folded_into_service_id,
  DROP COLUMN IF EXISTS stream;

DROP INDEX IF EXISTS hsdg.engagements_merged_into_idx;
DROP INDEX IF EXISTS hsdg.engagements_kind_idx;
ALTER TABLE hsdg.engagements DROP CONSTRAINT IF EXISTS engagements_merged_target;
ALTER TABLE hsdg.engagements DROP CONSTRAINT engagements_status_check;
ALTER TABLE hsdg.engagements ADD CONSTRAINT engagements_status_check CHECK (status IN
  ('prospect','pending_acceptance','accepted','active','on_hold',
   'completed','closed','declined','withdrawn','cancelled'));
ALTER TABLE hsdg.engagements DROP COLUMN IF EXISTS merged_into_id, DROP COLUMN IF EXISTS kind;

ALTER TABLE hsdg.service_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions FORCE ROW LEVEL SECURITY;

