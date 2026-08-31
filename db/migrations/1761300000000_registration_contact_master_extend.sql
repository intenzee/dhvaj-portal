-- ─────────────────────────────────────────────────────────────────────────
-- 0048 · Registration & contact master completion  (spec §10–§12, §24; ADR-0033)
--
-- Extend the two existing child masters to the Add Client spec:
--   • entity_registrations — the §10 lifecycle/verification fields; widen status
--     to include 'pending'/'expired' (§12); add a SEPARATE `applicability` so a
--     pending APPLICATION (a status) is never confused with "not required" (an
--     applicability) — the §12 distinction. Existing effective dating stays on
--     valid_from/valid_to; registration_date is the grant date.
--   • entity_contacts — department, contact_type, portal user/role (§24).
--
-- Additive only; RLS/policies unchanged. Historical rows are retained on
-- cancel/expire (no destructive change). Verification is set via a reviewed
-- service action in Phase B.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── entity_registrations (§10, §12) ───────────────────────────────────────
ALTER TABLE hsdg.entity_registrations
  ADD COLUMN jurisdiction       text,   -- broader than state_code (authority jurisdiction)
  ADD COLUMN registration_date  date,   -- date granted (§10)
  ADD COLUMN issuing_authority  text,
  ADD COLUMN source             text NOT NULL DEFAULT 'client'
               CHECK (source IN ('client','hsdg','government_portal','other')),
  -- Principal vs additional place of business (GST etc.).
  ADD COLUMN is_principal       boolean NOT NULL DEFAULT true,
  ADD COLUMN verified           boolean NOT NULL DEFAULT false,
  ADD COLUMN verified_by        uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  ADD COLUMN verified_at        timestamptz,
  ADD COLUMN document_ref       text,   -- soft link to certificate/evidence
  -- Applicability is a SEPARATE axis from status (§12): unknown vs under
  -- assessment vs applicable vs not-applicable. Never inferred from a missing
  -- registration.
  ADD COLUMN applicability      text NOT NULL DEFAULT 'unknown'
               CHECK (applicability IN ('unknown','under_assessment','applicable','not_applicable'));

-- Widen status to include the application lifecycle (§12): pending / expired.
ALTER TABLE hsdg.entity_registrations DROP CONSTRAINT entity_registrations_status_check;
ALTER TABLE hsdg.entity_registrations ADD  CONSTRAINT entity_registrations_status_check
  CHECK (status IN ('pending','active','inactive','cancelled','suspended','expired'));

CREATE INDEX entity_registrations_status_idx ON hsdg.entity_registrations (status);
CREATE INDEX entity_registrations_applicability_idx ON hsdg.entity_registrations (applicability);

-- ── entity_contacts (§24) ─────────────────────────────────────────────────
ALTER TABLE hsdg.entity_contacts
  ADD COLUMN department     text,
  ADD COLUMN contact_type   text CHECK (contact_type IS NULL OR contact_type IN
                   ('promoter','director','cfo','finance_head','accounts','cs',
                    'hr','gst','tax','authorised_signatory','other')),
  ADD COLUMN is_portal_user boolean NOT NULL DEFAULT false,
  -- Portal role only meaningful when is_portal_user; enforced at service layer.
  ADD COLUMN portal_role    text;

-- Down Migration

ALTER TABLE hsdg.entity_contacts
  DROP COLUMN IF EXISTS portal_role,
  DROP COLUMN IF EXISTS is_portal_user,
  DROP COLUMN IF EXISTS contact_type,
  DROP COLUMN IF EXISTS department;

DROP INDEX IF EXISTS hsdg.entity_registrations_applicability_idx;
DROP INDEX IF EXISTS hsdg.entity_registrations_status_idx;

ALTER TABLE hsdg.entity_registrations DROP CONSTRAINT entity_registrations_status_check;
ALTER TABLE hsdg.entity_registrations ADD  CONSTRAINT entity_registrations_status_check
  CHECK (status IN ('active','inactive','cancelled','suspended'));

ALTER TABLE hsdg.entity_registrations
  DROP COLUMN IF EXISTS applicability,
  DROP COLUMN IF EXISTS document_ref,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS verified_by,
  DROP COLUMN IF EXISTS verified,
  DROP COLUMN IF EXISTS is_principal,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS issuing_authority,
  DROP COLUMN IF EXISTS registration_date,
  DROP COLUMN IF EXISTS jurisdiction;
