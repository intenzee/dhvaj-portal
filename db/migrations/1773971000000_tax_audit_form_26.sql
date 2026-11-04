-- ─────────────────────────────────────────────────────────────────────────
-- Tax audit under the Income-tax Act 2025: Form 26
--
-- From tax year 2026-27 a tax audit is under s.63 of the Income-tax Act 2025
-- and reported in one Form 26 (rule 47, Income-tax Rules 2026), which takes
-- the place of Form 3CA / 3CB and the 3CD particulars. FY 2025-26 and earlier
-- stay on the 1961 Act's 3CA / 3CB with 3CD (library version 1).
--
-- The Form 26 clause library starts here as a draft version: the stream lead
-- enters its clauses from the notified form under Admin and publishes it
-- before the first 2026-27 audit opens its clause work. Nothing picks a draft.
-- Skipped when a 2025-Act version is already there.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.tax_audit_clause_library_versions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.tax_audit_clause_library_versions (version_no, label, act, form, applies_from_fy, status, notes)
SELECT COALESCE(max(version_no), 0) + 1,
       'Form 26 — Income-tax Rules 2026', '2025', '26', '2026-27', 'draft',
       'Tax audit report under s.63 of the Income-tax Act 2025 (rule 47), replacing Forms 3CA, 3CB and 3CD from tax year 2026-27. Enter the clauses from the notified Form 26, then publish.'
  FROM hsdg.tax_audit_clause_library_versions
HAVING NOT EXISTS (SELECT 1 FROM hsdg.tax_audit_clause_library_versions WHERE act = '2025');
ALTER TABLE hsdg.tax_audit_clause_library_versions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.tax_audit_clause_library_versions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.tax_audit_clause_library_versions v
 WHERE v.act = '2025' AND v.form = '26' AND v.status = 'draft'
   AND NOT EXISTS (SELECT 1 FROM hsdg.tax_audit_clause_library c WHERE c.library_version_id = v.id);
ALTER TABLE hsdg.tax_audit_clause_library_versions FORCE ROW LEVEL SECURITY;
