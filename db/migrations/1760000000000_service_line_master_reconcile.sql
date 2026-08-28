-- ─────────────────────────────────────────────────────────────────────────
-- 0035 · Service-line master reconciliation to the frozen §3 (14 lines) + §17
--
-- The FINAL_BALANCED Service Catalogue Master (§3) freezes FOURTEEN co-equal
-- top-level service lines and requires "every Service Line the same structural
-- treatment" (§30). The build had folded six of them — Transaction Advisory,
-- FEMA, Valuation, Virtual CFO, Governance and Forensic — into a single
-- ADVISORY line, and carried a LITIGATION line the master does not have (the
-- master keeps litigation as SERVICES under Direct Tax / GST). This migration
-- reconciles the master WITHOUT renaming existing line codes (a deliberate
-- decision — codes are internal keys resolved by lookup; the human-facing names
-- already match the spec):
--
--   #1  Adds the five missing advisory-family lines (FEMA, VAL, CFO, GOV, FOR)
--       as co-equal top-level lines and re-parents the folded services to them.
--       ADVISORY is retained as the spec's ADV (Transaction & Business
--       Advisory) line. ITAT_REP is re-parented to TAX and the now-empty
--       LITIGATION line is dropped, matching the frozen 14.
--
--   #2  Adds the §17 OTHER ("Other Professional Services") controlled fallback
--       line + its single "Other Professional Assignment" service, and a new
--       `service.manage_other` permission (granted to the Managing Partner
--       only) that the API requires — together with a recorded approval
--       reference — before any service may be created under OTHER. This is the
--       "creation requires authorised catalogue approval" control from §17.
--
-- DATA + one additive column (services.approval_reference). Idempotent on the
-- config rows (keyed by UNIQUE code / permission slug). RLS: the migrator holds
-- no role context, so the firm-wide write policies on these config tables block
-- reads+writes under FORCE — drop FORCE on every table touched, do the work,
-- restore FORCE (mirrors 0007 / 0034).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.service_lines     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.roles             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions  NO FORCE ROW LEVEL SECURITY;

-- ── #2a. Record of the authorised approval behind an OTHER service ─────────
ALTER TABLE hsdg.services ADD COLUMN IF NOT EXISTS approval_reference text;

-- ── #1a. The five missing advisory-family lines + #2b OTHER fallback ───────
INSERT INTO hsdg.service_lines (code, name, display_order) VALUES
  ('FEMA',  'FEMA & International Advisory',       10),
  ('VAL',   'Valuation',                           11),
  ('CFO',   'Virtual CFO / Finance Advisory',      12),
  ('GOV',   'Governance / Secretarial Advisory',   13),
  ('FOR',   'Forensic / Investigation',            14),
  ('OTHER', 'Other Professional Services',         15)
ON CONFLICT (code) DO NOTHING;

-- ── #1b. Re-parent the folded services to their own top-level lines ────────
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'FEMA'  AND s.code = 'FEMA';
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'VAL'   AND s.code = 'VALUATION';
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'CFO'   AND s.code = 'VIRTUAL_CFO';
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'GOV'   AND s.code = 'GOVERNANCE';
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'FOR'   AND s.code = 'FORENSIC';

-- ── #1c. Litigation is a SERVICE under Direct Tax, not a line — re-parent ──
--        ITAT_REP to TAX, then drop the now-empty LITIGATION line.
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'TAX' AND s.code = 'ITAT_REP';

-- Guarded: only removes the line once nothing references it (FK is ON DELETE
-- RESTRICT, so this is also enforced by the database — the guard keeps the
-- migration a clean no-op if a future service was added under LITIGATION).
DELETE FROM hsdg.service_lines sl
WHERE sl.code = 'LITIGATION'
  AND NOT EXISTS (SELECT 1 FROM hsdg.services s WHERE s.service_line_id = sl.id);

-- ── #2c. The §17 controlled fallback service under OTHER ───────────────────
INSERT INTO hsdg.services
  (service_line_id, code, name, description, required_review_model_id,
   workflow_family_id, default_recurrence)
SELECT sl.id, 'OTHER_PROF', 'Other Professional Assignment',
       'Controlled fallback for genuinely new professional work (spec §17). '
       || 'Creating services under this line requires the service.manage_other '
       || 'permission and a recorded approval reference.',
       rm.id, wf.id, 'as_required'
FROM hsdg.service_lines sl
JOIN hsdg.review_models rm ON rm.slug = 'key_matter_review'
JOIN hsdg.workflow_families wf ON wf.slug = 'advisory_workflow'
WHERE sl.code = 'OTHER'
ON CONFLICT (code) DO NOTHING;

-- ── #2d. The OTHER-creation control permission (MP-only) ───────────────────
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('service.manage_other',
   'Authorise and create services under the Other Professional Services fallback line')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM hsdg.roles r
JOIN hsdg.permissions p ON p.slug = 'service.manage_other'
WHERE r.slug = 'managing_partner'
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.role_permissions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions       FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.roles             FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models     FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_lines     FORCE ROW LEVEL SECURITY;

-- Down Migration
-- Restore the pre-reconciliation shape: recreate LITIGATION, move its service
-- back, fold the five advisory lines back into ADVISORY, drop OTHER + the
-- permission + the column. Codes are the stable keys throughout.

ALTER TABLE hsdg.service_lines     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions  NO FORCE ROW LEVEL SECURITY;

-- Recreate the LITIGATION line and move ITAT_REP back under it.
INSERT INTO hsdg.service_lines (code, name, display_order) VALUES
  ('LITIGATION', 'Litigation', 6)
ON CONFLICT (code) DO NOTHING;
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'LITIGATION' AND s.code = 'ITAT_REP';

-- Fold the five advisory-family services back under ADVISORY.
UPDATE hsdg.services s SET service_line_id = sl.id
FROM hsdg.service_lines sl
WHERE sl.code = 'ADVISORY'
  AND s.code IN ('FEMA', 'VALUATION', 'VIRTUAL_CFO', 'GOVERNANCE', 'FORENSIC');

-- Remove the OTHER fallback service before its line.
DELETE FROM hsdg.services WHERE code = 'OTHER_PROF';

-- Drop the six added lines (now empty).
DELETE FROM hsdg.service_lines WHERE code IN ('FEMA', 'VAL', 'CFO', 'GOV', 'FOR', 'OTHER');

-- Remove the permission grant + permission.
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'service.manage_other');
DELETE FROM hsdg.permissions WHERE slug = 'service.manage_other';

ALTER TABLE hsdg.services DROP COLUMN IF EXISTS approval_reference;

ALTER TABLE hsdg.role_permissions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions       FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_lines     FORCE ROW LEVEL SECURITY;
