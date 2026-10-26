-- ─────────────────────────────────────────────────────────────────────────
-- One client, several offices
--
-- A legal entity (one PAN) is one client; each place it is registered for
-- GST is an office of it, shown as a tab on Client 360 (CM-6).
-- "Drift Logistics Private Limited" and "Drift Logistics Private Limited
-- (Delhi" become one client with a head office and a Delhi office.
--
-- Registrations, addresses and contacts may name their office (branch_id);
-- NULL is the whole client. Logins, return marks and GST filings point at the
-- GSTIN and follow its office through it.
--
-- A merged client's offices move to the client it was merged into, by a
-- trigger, so the plain merge and the combine both carry them. Dismissals
-- gain a kind: "not the same client" and "not offices of one business" are
-- two answers.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.entity_branches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  label          text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  state_code     text CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  is_head_office boolean NOT NULL DEFAULT false,
  archived_at    timestamptz,
  created_by     uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1
);
CREATE INDEX entity_branches_entity_idx ON hsdg.entity_branches (entity_id);
CREATE UNIQUE INDEX entity_branches_label_unique
  ON hsdg.entity_branches (entity_id, lower(label)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX entity_branches_one_head_office
  ON hsdg.entity_branches (entity_id) WHERE is_head_office AND archived_at IS NULL;
CREATE TRIGGER entity_branches_set_updated_at BEFORE UPDATE ON hsdg.entity_branches
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE ALL ON hsdg.entity_branches FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.entity_branches TO hsdg_app;
ALTER TABLE hsdg.entity_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_branches FORCE ROW LEVEL SECURITY;
-- An office is seen and written by whoever sees its client (entities' own
-- policies decide what "sees" means).
CREATE POLICY entity_branches_all ON hsdg.entity_branches
  FOR ALL TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_branches.entity_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_branches.entity_id));
-- merge_entities runs as the owner with the merge flag set.
CREATE POLICY entity_branches_client_merge ON hsdg.entity_branches
  FOR ALL TO hsdg_migrator
  USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());

ALTER TABLE hsdg.entity_registrations
  ADD COLUMN branch_id uuid REFERENCES hsdg.entity_branches (id) ON DELETE SET NULL;
ALTER TABLE hsdg.entity_addresses
  ADD COLUMN branch_id uuid REFERENCES hsdg.entity_branches (id) ON DELETE SET NULL;
ALTER TABLE hsdg.entity_contacts
  ADD COLUMN branch_id uuid REFERENCES hsdg.entity_branches (id) ON DELETE SET NULL;
CREATE INDEX entity_registrations_branch_idx ON hsdg.entity_registrations (branch_id)
  WHERE branch_id IS NOT NULL;

-- A merged client's offices go to the client it was merged into. A label the
-- keeper already uses gets the old client's code; the keeper's head office stays.
CREATE OR REPLACE FUNCTION hsdg.entities_move_branches_on_merge() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merged_into_id IS NULL OR OLD.merged_into_id IS NOT DISTINCT FROM NEW.merged_into_id THEN
    RETURN NEW;
  END IF;
  UPDATE hsdg.entity_branches b
     SET is_head_office = false
   WHERE b.entity_id = NEW.id AND b.is_head_office
     AND EXISTS (SELECT 1 FROM hsdg.entity_branches k
                  WHERE k.entity_id = NEW.merged_into_id AND k.is_head_office
                    AND k.archived_at IS NULL);
  UPDATE hsdg.entity_branches b
     SET label = left(b.label || ' (' || NEW.entity_code || ')', 80)
   WHERE b.entity_id = NEW.id AND b.archived_at IS NULL
     AND EXISTS (SELECT 1 FROM hsdg.entity_branches k
                  WHERE k.entity_id = NEW.merged_into_id AND k.archived_at IS NULL
                    AND lower(k.label) = lower(b.label));
  UPDATE hsdg.entity_branches SET entity_id = NEW.merged_into_id WHERE entity_id = NEW.id;
  RETURN NEW;
END $$;

CREATE TRIGGER entities_move_branches_on_merge
  AFTER UPDATE OF merged_into_id ON hsdg.entities
  FOR EACH ROW EXECUTE FUNCTION hsdg.entities_move_branches_on_merge();

-- "Not the same client" (duplicate) vs "not offices of one business" (branch).
ALTER TABLE hsdg.entity_duplicate_dismissals
  ADD COLUMN kind text NOT NULL DEFAULT 'duplicate' CHECK (kind IN ('duplicate', 'branch'));
ALTER TABLE hsdg.entity_duplicate_dismissals
  DROP CONSTRAINT entity_duplicate_dismissals_unique;
ALTER TABLE hsdg.entity_duplicate_dismissals
  ADD CONSTRAINT entity_duplicate_dismissals_unique UNIQUE (entity_a_id, entity_b_id, kind);

-- Down Migration

ALTER TABLE hsdg.entity_duplicate_dismissals NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.entity_duplicate_dismissals WHERE kind = 'branch';
ALTER TABLE hsdg.entity_duplicate_dismissals FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_duplicate_dismissals
  DROP CONSTRAINT entity_duplicate_dismissals_unique;
ALTER TABLE hsdg.entity_duplicate_dismissals
  ADD CONSTRAINT entity_duplicate_dismissals_unique UNIQUE (entity_a_id, entity_b_id);
ALTER TABLE hsdg.entity_duplicate_dismissals DROP COLUMN kind;

DROP TRIGGER IF EXISTS entities_move_branches_on_merge ON hsdg.entities;
DROP FUNCTION IF EXISTS hsdg.entities_move_branches_on_merge();
ALTER TABLE hsdg.entity_contacts DROP COLUMN IF EXISTS branch_id;
ALTER TABLE hsdg.entity_addresses DROP COLUMN IF EXISTS branch_id;
DROP INDEX IF EXISTS hsdg.entity_registrations_branch_idx;
ALTER TABLE hsdg.entity_registrations DROP COLUMN IF EXISTS branch_id;
DROP TABLE IF EXISTS hsdg.entity_branches;
