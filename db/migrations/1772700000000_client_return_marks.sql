-- ─────────────────────────────────────────────────────────────────────────
-- ADR-0035 · The firm's GST return history, from its login workbook
--
-- client_return_marks — what the firm's GST sheet says was filed or not
-- applicable, month by month (or quarter by quarter) and form by form:
-- GSTR-1, GSTR-3B, GSTR-7. Until now the import only closed the matching
-- compliance filings, so a client without a GST engagement (or without its
-- GSTIN in the sheet) lost the marks. They are kept here as the client's
-- record, whatever the portal's filings say.
--
-- A mark is for the client's GSTIN (registration_id), or — when the sheet
-- has no GSTIN — for the state in the name ("ABC (Delhi)"), or for the
-- client alone. period_key is a compliance period key: '2026-04' for a
-- month, '2026-27:Q1' for a quarter. Importing again refreshes a mark.
--
-- Visible exactly when the client is visible; written by whoever may manage
-- the client's logins (the import needs credential.manage anyway).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.client_return_marks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  registration_id     uuid REFERENCES hsdg.entity_registrations (id) ON DELETE CASCADE,
  state_code          text CHECK (state_code ~ '^[0-9]{2}$'),
  return_form         text NOT NULL CHECK (return_form IN ('GSTR1', 'GSTR3B', 'GSTR7')),
  period_key          text NOT NULL
                        CHECK (period_key ~ '^[0-9]{4}-[0-9]{2}$'
                               OR period_key ~ '^[0-9]{4}-[0-9]{2}:Q[1-4]$'),
  mark                text NOT NULL CHECK (mark IN ('filed', 'not_applicable')),
  source_file         text CHECK (length(source_file) <= 200),
  source_sheet        text CHECK (length(source_sheet) <= 100),
  source_row          integer,
  imported_by_user_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- One mark per client, GSTIN (or state while there is none), form and period.
CREATE UNIQUE INDEX client_return_marks_one_per_period ON hsdg.client_return_marks
  (entity_id, COALESCE(registration_id::text, state_code, ''), return_form, period_key);
CREATE INDEX client_return_marks_registration_idx ON hsdg.client_return_marks (registration_id);
CREATE TRIGGER client_return_marks_set_updated_at BEFORE UPDATE ON hsdg.client_return_marks
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE ALL ON hsdg.client_return_marks FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.client_return_marks TO hsdg_app;

ALTER TABLE hsdg.client_return_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.client_return_marks FORCE  ROW LEVEL SECURITY;

CREATE POLICY client_return_marks_owner ON hsdg.client_return_marks
  TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY client_return_marks_select ON hsdg.client_return_marks
  FOR SELECT TO hsdg_app USING (
    EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_id)
  );
CREATE POLICY client_return_marks_insert ON hsdg.client_return_marks
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.ctx_can_manage_credentials(entity_id));
CREATE POLICY client_return_marks_update ON hsdg.client_return_marks
  FOR UPDATE TO hsdg_app USING (hsdg.ctx_can_manage_credentials(entity_id))
  WITH CHECK (hsdg.ctx_can_manage_credentials(entity_id));
CREATE POLICY client_return_marks_delete ON hsdg.client_return_marks
  FOR DELETE TO hsdg_app USING (hsdg.ctx_can_manage_credentials(entity_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.client_return_marks;
