-- ─────────────────────────────────────────────────────────────────────────
-- 0028 · Due-Date Classification & Government Extensions
--
-- Closes the three gaps between the Due-Date Classification & Service Component
-- Mapping specification and the compliance engine (0013) / component catalogue
-- (0020):
--
--   1. Frozen Due-Date CATEGORY (spec §2) — HOW a deadline is generated
--      (STATUTORY_FIXED … NO_FIXED_DATE). A separate axis from the statutory
--      DOMAIN already on compliance_rules.category (income_tax/gst/…). Added to
--      BOTH the compliance rule (drives calendar events) and the catalogue
--      component (the §6–§15 Component Mapping tags).
--
--   2. Due-Date SOURCE (spec §3) — WHERE the deadline's authority comes from
--      (LAW_RULE, GOVERNMENT_NOTIFICATION, HSDG_POLICY, ENGAGEMENT_LETTER,
--      CLIENT_COMMITMENT, WORKFLOW, USER_ENTERED). Independent of category;
--      optional. Added to the rule and the component.
--
--   3. Government EXTENSIONS as OVERLAYS (spec §19) — a government-notified
--      revised statutory date is a first-class overlay record, NOT an edit to
--      the rule and NOT the generic manual override (§20). It retains the
--      original date, records the revised operative date, notification
--      reference, applicable population and effective date, and is applied to a
--      compliance instance via a pointer. The instance's effective statutory
--      clock then reads: manual override (§20 exception) ▸ government extension
--      (§19 overlay) ▸ computed snapshot. The original is always retained.
--
-- Categories/sources are CHECK-constrained to the frozen sets so the database is
-- the system of record for the vocabulary (mirrors compliance_rules.category).
-- Government extensions are firm-wide CONFIG (like rules): any authenticated
-- context reads; only firm-wide (system/MP/admin) writes. They are append-only
-- evidence — UPDATE/DELETE are revoked, so an applied overlay can never be
-- silently rewritten (mirrors compliance_rule_versions).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Frozen due-date category + source on the compliance RULE ───────────
-- Existing rules default to NO_FIXED_DATE (the safe "unclassified" category)
-- until an administrator classifies them; source is optional (NULL = unstated).
ALTER TABLE hsdg.compliance_rules
  ADD COLUMN due_date_category text NOT NULL DEFAULT 'NO_FIXED_DATE'
    CHECK (due_date_category IN
      ('STATUTORY_FIXED','STATUTORY_RULE','STATUTORY_EVENT','GOVT_EXTENSION',
       'HSDG_RECURRING','HSDG_MILESTONE','CLIENT_COMMITTED','TASK_DEADLINE',
       'EVENT_SLA','NO_FIXED_DATE')),
  ADD COLUMN due_date_source text
    CHECK (due_date_source IS NULL OR due_date_source IN
      ('LAW_RULE','GOVERNMENT_NOTIFICATION','HSDG_POLICY','ENGAGEMENT_LETTER',
       'CLIENT_COMMITMENT','WORKFLOW','USER_ENTERED'));

-- ── 2. Same classification on the catalogue COMPONENT (§6–§15 mapping) ─────
ALTER TABLE hsdg.service_components
  ADD COLUMN due_date_category text NOT NULL DEFAULT 'NO_FIXED_DATE'
    CHECK (due_date_category IN
      ('STATUTORY_FIXED','STATUTORY_RULE','STATUTORY_EVENT','GOVT_EXTENSION',
       'HSDG_RECURRING','HSDG_MILESTONE','CLIENT_COMMITTED','TASK_DEADLINE',
       'EVENT_SLA','NO_FIXED_DATE')),
  ADD COLUMN due_date_source text
    CHECK (due_date_source IS NULL OR due_date_source IN
      ('LAW_RULE','GOVERNMENT_NOTIFICATION','HSDG_POLICY','ENGAGEMENT_LETTER',
       'CLIENT_COMMITMENT','WORKFLOW','USER_ENTERED'));

-- ── 3. Government extensions (firm-wide config; append-only overlays) ──────
CREATE TABLE hsdg.government_extensions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The statutory obligation being extended. RESTRICT: an extension is evidence
  -- tied to a specific rule and must not be orphaned by deleting the rule.
  compliance_rule_id   uuid NOT NULL REFERENCES hsdg.compliance_rules (id) ON DELETE RESTRICT,
  -- The original statutory date this notification revises (retained historically).
  original_due_date    date NOT NULL,
  -- The current operative deadline the calendar surfaces prominently (§19).
  revised_due_date     date NOT NULL,
  -- Authority/source of the extension (e.g. a CBDT/CBIC notification number).
  notification_reference text NOT NULL CHECK (length(trim(notification_reference)) > 0),
  -- Who receives the extension (§19 "Applicable Population") — a description or
  -- criteria (e.g. "All GSTR-3B filers, turnover ≤ ₹5cr, State: MH").
  applicable_population text NOT NULL CHECK (length(trim(applicable_population)) > 0),
  -- When the extension becomes operative.
  effective_date       date NOT NULL,
  notes                text,
  -- Audit event: who imported/applied it.
  created_by_user_id   uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- An extension moves the deadline forward (or holds it) — never earlier.
  CONSTRAINT government_extensions_dates CHECK (revised_due_date >= original_due_date)
);
CREATE INDEX government_extensions_rule_idx
  ON hsdg.government_extensions (compliance_rule_id, effective_date DESC);

-- ── 4. Overlay pointer on the compliance INSTANCE ─────────────────────────
-- NULL = no extension. SET NULL on delete keeps the instance valid; extensions
-- are append-only anyway (delete is revoked below), so this is belt-and-braces.
ALTER TABLE hsdg.compliance_instances
  ADD COLUMN government_extension_id uuid
    REFERENCES hsdg.government_extensions (id) ON DELETE SET NULL;
CREATE INDEX compliance_instances_extension_idx
  ON hsdg.compliance_instances (government_extension_id)
  WHERE government_extension_id IS NOT NULL;

-- ── 5. Privileges: extensions are append-only evidence ────────────────────
REVOKE UPDATE, DELETE ON hsdg.government_extensions FROM hsdg_app;

-- ── 6. Row Level Security: firm-wide config (read all, write firm-wide) ───
ALTER TABLE hsdg.government_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions FORCE  ROW LEVEL SECURITY;
CREATE POLICY government_extensions_read ON hsdg.government_extensions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY government_extensions_insert ON hsdg.government_extensions
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

-- Down Migration

DROP POLICY IF EXISTS government_extensions_insert ON hsdg.government_extensions;
DROP POLICY IF EXISTS government_extensions_read ON hsdg.government_extensions;

DROP INDEX IF EXISTS hsdg.compliance_instances_extension_idx;
ALTER TABLE hsdg.compliance_instances DROP COLUMN IF EXISTS government_extension_id;

DROP TABLE IF EXISTS hsdg.government_extensions CASCADE;

ALTER TABLE hsdg.service_components DROP COLUMN IF EXISTS due_date_source;
ALTER TABLE hsdg.service_components DROP COLUMN IF EXISTS due_date_category;
ALTER TABLE hsdg.compliance_rules DROP COLUMN IF EXISTS due_date_source;
ALTER TABLE hsdg.compliance_rules DROP COLUMN IF EXISTS due_date_category;
