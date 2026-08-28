-- ─────────────────────────────────────────────────────────────────────────
-- 0034 · Flag registration-work catalogue components  (spec §40)
--
-- Marks the catalogue components that ARE registration work so completing their
-- instances writes the produced number into the Registration Master (0033).
-- Additive data-only change.
--
-- service_components is FORCE ROW LEVEL SECURITY, so the migrator (no employee
-- context) is subject to its policies and a plain UPDATE would match zero rows.
-- Drop FORCE for the data change and restore it immediately, all within this
-- migration's transaction — the same pattern the catalogue seed uses.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.service_components SET sets_registration_type = 'gstin' WHERE code = 'GSTR_NEW';
ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.service_components SET sets_registration_type = NULL WHERE code = 'GSTR_NEW';
ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;
