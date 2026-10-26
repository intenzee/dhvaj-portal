-- ─────────────────────────────────────────────────────────────────────────
-- Where a client's firm type came from
--
-- The firm type follows the PAN's 4th letter (or the GSTIN's 6th) whatever an
-- import file says, but a type set by hand on Client 360 is kept and later
-- imports leave it alone (CM-3). Precedence: manual > pan > import > nothing.
-- Existing clients are 'legacy'; the data check lists those whose type
-- disagrees with the PAN and fixes them after review.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.entities
  ADD COLUMN entity_type_source text NOT NULL DEFAULT 'legacy'
    CHECK (entity_type_source IN ('pan', 'manual', 'import', 'legacy')),
  ADD COLUMN entity_type_set_by uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  ADD COLUMN entity_type_set_at timestamptz;

-- Down Migration

ALTER TABLE hsdg.entities
  DROP COLUMN IF EXISTS entity_type_set_at,
  DROP COLUMN IF EXISTS entity_type_set_by,
  DROP COLUMN IF EXISTS entity_type_source;
