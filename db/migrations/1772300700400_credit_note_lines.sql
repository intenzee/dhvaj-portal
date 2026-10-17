-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-205 (follow-up) · a credit note's GST per invoice line
--
-- A credit note now reduces named lines of its invoice, each taxed at that
-- line's own GST rate, instead of one amount at one rate. The note's header
-- (taxable value, CGST/SGST/IGST) is the sum of its lines — checked when the
-- transaction commits — and gst_rate is the lines' one rate, or NULL when
-- they differ. A line cannot be credited beyond what is left of it after the
-- other pending and approved credit notes. Lines are written with their note
-- (pending) and never change after.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.credit_notes ALTER COLUMN gst_rate DROP NOT NULL;

CREATE TABLE hsdg.credit_note_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id   uuid NOT NULL REFERENCES hsdg.credit_notes (id) ON DELETE CASCADE,
  invoice_line_id  uuid NOT NULL REFERENCES hsdg.invoice_line_items (id),
  description      text NOT NULL CHECK (length(btrim(description)) > 0),
  taxable_value    numeric(14,2) NOT NULL CHECK (taxable_value > 0),
  gst_rate         numeric(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 28),
  cgst             numeric(14,2) NOT NULL DEFAULT 0 CHECK (cgst >= 0),
  sgst             numeric(14,2) NOT NULL DEFAULT 0 CHECK (sgst >= 0),
  igst             numeric(14,2) NOT NULL DEFAULT 0 CHECK (igst >= 0),
  total            numeric(14,2) GENERATED ALWAYS AS (taxable_value + cgst + sgst + igst) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_lines_cgst_equals_sgst CHECK (cgst = sgst),
  CONSTRAINT credit_note_lines_once UNIQUE (credit_note_id, invoice_line_id)
);
CREATE INDEX credit_note_lines_invoice_line_idx ON hsdg.credit_note_lines (invoice_line_id);

-- A line of the note's own invoice, on a pending note, within what is left.
CREATE OR REPLACE FUNCTION hsdg.credit_note_line_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_note    hsdg.credit_notes%ROWTYPE;
  v_line    numeric(14,2);
  v_credited numeric(14,2);
BEGIN
  SELECT * INTO v_note FROM hsdg.credit_notes WHERE id = NEW.credit_note_id;
  IF NOT FOUND OR v_note.status <> 'pending' THEN
    RAISE EXCEPTION 'A credit note''s lines are written with it, while it is pending.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credit_note_lines_pending';
  END IF;
  SELECT l.taxable_value INTO v_line
    FROM hsdg.invoice_line_items l
   WHERE l.id = NEW.invoice_line_id AND l.invoice_id = v_note.invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A credit note line must be a line of its invoice.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credit_note_lines_same_invoice';
  END IF;
  -- One writer per invoice line at a time, so two notes cannot both take the rest.
  PERFORM pg_advisory_xact_lock(hashtextextended('credit_note_line:' || NEW.invoice_line_id, 0));
  SELECT COALESCE(sum(cl.taxable_value), 0) INTO v_credited
    FROM hsdg.credit_note_lines cl
    JOIN hsdg.credit_notes cn ON cn.id = cl.credit_note_id
   WHERE cl.invoice_line_id = NEW.invoice_line_id
     AND cn.status IN ('pending', 'approved');
  IF v_credited + NEW.taxable_value > v_line THEN
    RAISE EXCEPTION 'Only % of this invoice line is left to credit.', v_line - v_credited
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credit_note_lines_within_line';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_note_lines_guard BEFORE INSERT ON hsdg.credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION hsdg.credit_note_line_guard();

-- At commit: a note with lines carries their sums.
CREATE OR REPLACE FUNCTION hsdg.credit_note_lines_add_up() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM hsdg.credit_notes cn
      JOIN LATERAL (
        SELECT sum(cl.taxable_value) AS taxable, sum(cl.cgst) AS cgst,
               sum(cl.sgst) AS sgst, sum(cl.igst) AS igst
          FROM hsdg.credit_note_lines cl WHERE cl.credit_note_id = cn.id
      ) s ON true
     WHERE cn.id = NEW.credit_note_id
       AND (s.taxable, s.cgst, s.sgst, s.igst)
           IS DISTINCT FROM (cn.taxable_value, cn.cgst, cn.sgst, cn.igst)
  ) THEN
    RAISE EXCEPTION 'A credit note must equal the sum of its lines.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credit_note_lines_add_up';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER credit_note_lines_add_up AFTER INSERT ON hsdg.credit_note_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hsdg.credit_note_lines_add_up();

-- Seen and written by whoever may see the note (credit_notes RLS: ctx_can_bill).
ALTER TABLE hsdg.credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.credit_note_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY credit_note_lines_billing ON hsdg.credit_note_lines
  TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.credit_notes cn WHERE cn.id = credit_note_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.credit_notes cn WHERE cn.id = credit_note_id));
CREATE POLICY credit_note_lines_owner ON hsdg.credit_note_lines
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.credit_note_lines TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.credit_note_lines;
DROP FUNCTION IF EXISTS hsdg.credit_note_lines_add_up();
DROP FUNCTION IF EXISTS hsdg.credit_note_line_guard();
UPDATE hsdg.credit_notes SET gst_rate = 0 WHERE gst_rate IS NULL;
ALTER TABLE hsdg.credit_notes ALTER COLUMN gst_rate SET NOT NULL;
