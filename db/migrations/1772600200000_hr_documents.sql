-- ─────────────────────────────────────────────────────────────────────────
-- HR role · the HR documents vault (spec docs/accountant-hr-roles-spec.md
-- §4.7, and §7.3 for tax proofs).
--
-- hr_documents — one row per file kept about a person: offer and appointment
--                letters, the articleship deed, NDA / confidentiality
--                undertaking, ID proofs, tax-declaration proofs. Metadata
--                only; the bytes live in the configured document storage
--                (SharePoint when M365 storage is on) under an opaque
--                reference namespaced "hr/<employee>/<document>/<random>",
--                which is never returned to a client.
--
-- Access (FORCE RLS): HR and the Managing Partner only — not the person
-- themselves, not their manager, not the administrator. Files are never
-- deleted through the API; a mistaken upload is archived (and can be
-- restored), and every download is audited.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.hr_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  kind                text NOT NULL CHECK (kind IN ('offer_letter','appointment_letter','articleship_deed',
                                                    'nda','id_proof','tax_proof','other')),
  title               text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  filename            text NOT NULL CHECK (length(filename) BETWEEN 1 AND 400),
  content_type        text NOT NULL CHECK (length(content_type) BETWEEN 1 AND 200),
  size_bytes          bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256     text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  storage_reference   text NOT NULL UNIQUE,
  note                text CHECK (note IS NULL OR length(note) <= 1000),
  uploaded_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  archived_at         timestamptz,
  archived_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_documents_reference_ns CHECK (storage_reference LIKE 'hr/%')
);
CREATE INDEX hr_documents_employee_idx ON hsdg.hr_documents (employee_id, created_at DESC);
CREATE TRIGGER hr_documents_set_updated_at BEFORE UPDATE ON hsdg.hr_documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Only the archive columns may change once a file is in; the file itself is
-- fixed (a new file is a new row).
CREATE FUNCTION hsdg.hr_documents_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.employee_id, NEW.kind, NEW.filename, NEW.content_type, NEW.size_bytes,
      NEW.checksum_sha256, NEW.storage_reference, NEW.uploaded_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.employee_id, OLD.kind, OLD.filename, OLD.content_type, OLD.size_bytes,
      OLD.checksum_sha256, OLD.storage_reference, OLD.uploaded_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'An HR document''s file cannot be changed; upload a new one.'
      USING ERRCODE = '23514', CONSTRAINT = 'hr_documents_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_documents_immutable BEFORE UPDATE ON hsdg.hr_documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.hr_documents_immutable();

ALTER TABLE hsdg.hr_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.hr_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY hr_documents_select ON hsdg.hr_documents FOR SELECT TO hsdg_app
  USING (hsdg.ctx_reads_people());
CREATE POLICY hr_documents_insert ON hsdg.hr_documents FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_reads_people());
CREATE POLICY hr_documents_update ON hsdg.hr_documents FOR UPDATE TO hsdg_app
  USING (hsdg.ctx_reads_people()) WITH CHECK (hsdg.ctx_reads_people());
CREATE POLICY hr_documents_owner ON hsdg.hr_documents TO hsdg_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.hr_documents TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.hr_documents;
DROP FUNCTION IF EXISTS hsdg.hr_documents_immutable();
