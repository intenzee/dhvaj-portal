-- ─────────────────────────────────────────────────────────────────────────
-- 0016 · Documents
--
-- Engagement-scoped professional evidence (§12). The actual bytes live in blob
-- storage (Azure Blob in production, a local filesystem provider in dev/test);
-- PostgreSQL stores ONLY metadata and an opaque storage reference. A user can
-- never obtain a file without an RLS-passing metadata read first — there is no
-- publicly guessable URL, and every download is audited by the application.
--
--   documents          — the LOGICAL document: engagement, title, type,
--                         classification, sensitivity, status (active/archived),
--                         and a pointer to its current version. Metadata is
--                         mutable (leads may re-classify / archive / restore).
--   document_versions   — the immutable version chain. Uploading again creates a
--                         NEW version and supersedes the current pointer; earlier
--                         versions and their blobs are RETAINED. Append-only to
--                         the app role (no UPDATE/DELETE) so completed/signed-off
--                         evidence can never be silently replaced (§12).
--
-- Access mirrors reviews/compliance/tasks: engagement-scoped RLS — members read,
-- leads write.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Logical documents (mutable metadata) ───────────────────────────────
CREATE TABLE hsdg.documents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  title                  text NOT NULL CHECK (length(trim(title)) > 0),
  document_type          text NOT NULL DEFAULT 'other' CHECK (document_type IN
                           ('engagement_letter','working_paper','evidence','financial_statement',
                            'report','correspondence','filing','acknowledgement','certificate','other')),
  classification         text NOT NULL DEFAULT 'internal' CHECK (classification IN
                           ('internal','client_shared','confidential','restricted')),
  sensitivity            text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN
                           ('normal','sensitive','highly_sensitive')),
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  -- Points at the newest row in document_versions (kept in step by the app on upload).
  current_version_id     uuid,
  current_version_no     integer NOT NULL DEFAULT 0,
  -- Optional retention hint (a date after which the document may be purged by a
  -- future retention job — never enforced destructively here).
  retention_until        date,
  archived_at            timestamptz,
  archived_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_archived_has_stamp CHECK (
    status <> 'archived' OR archived_at IS NOT NULL
  )
);
CREATE INDEX documents_engagement_idx ON hsdg.documents (engagement_id);
CREATE INDEX documents_active_idx ON hsdg.documents (engagement_id) WHERE status = 'active';
CREATE INDEX documents_type_idx ON hsdg.documents (document_type);
CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON hsdg.documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 2. Version chain (immutable; append-only professional evidence) ────────
CREATE TABLE hsdg.document_versions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id            uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  -- Denormalised for RLS (a version belongs to its document's engagement).
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version_no             integer NOT NULL CHECK (version_no > 0),
  filename               text NOT NULL CHECK (length(trim(filename)) > 0),
  content_type           text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes             bigint NOT NULL CHECK (size_bytes >= 0),
  -- SHA-256 of the bytes (integrity + de-dup signal). 64 lowercase hex chars.
  checksum_sha256        text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- Opaque key into the blob store. NEVER returned to clients (no URL bypass).
  storage_reference      text NOT NULL,
  note                   text,
  uploaded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  uploaded_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_unique UNIQUE (document_id, version_no)
);
CREATE INDEX document_versions_document_idx
  ON hsdg.document_versions (document_id, version_no DESC);
CREATE INDEX document_versions_engagement_idx ON hsdg.document_versions (engagement_id);

-- current_version_id points into the (later-created) version table.
ALTER TABLE hsdg.documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES hsdg.document_versions (id) ON DELETE SET NULL;

-- ── 3. Privileges: professional evidence is never hard-deleted at runtime ──
-- (default privileges granted SELECT/INSERT/UPDATE/DELETE from bootstrap.)
--  Version rows are append-only: keep INSERT, revoke UPDATE/DELETE so evidence
--  is never silently replaced. The logical `documents` row stays mutable
--  (re-classify / archive / restore) but is NOT deletable — a hard DELETE would
--  CASCADE into the immutable version chain, so we forbid it and use archive
--  instead (§20 "do not hard delete professional evidence").
REVOKE UPDATE, DELETE ON hsdg.document_versions FROM hsdg_app;
REVOKE DELETE         ON hsdg.documents         FROM hsdg_app;

-- ── 4. Row Level Security ──────────────────────────────────────────────────
-- Engagement-scoped: members read, leads write — access inherits the engagement.
ALTER TABLE hsdg.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.documents FORCE  ROW LEVEL SECURITY;
CREATE POLICY documents_select ON hsdg.documents
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY documents_insert ON hsdg.documents
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY documents_update ON hsdg.documents
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
-- No DELETE policy: documents are never hard-deleted (DELETE is revoked above).

-- document_versions: members read; leads insert; nobody updates/deletes (grants
-- above already forbid UPDATE/DELETE — the policies mirror the read/insert rule).
ALTER TABLE hsdg.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.document_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY document_versions_select ON hsdg.document_versions
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY document_versions_insert ON hsdg.document_versions
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS document_versions_insert ON hsdg.document_versions;
DROP POLICY IF EXISTS document_versions_select ON hsdg.document_versions;
DROP POLICY IF EXISTS documents_update ON hsdg.documents;
DROP POLICY IF EXISTS documents_insert ON hsdg.documents;
DROP POLICY IF EXISTS documents_select ON hsdg.documents;

ALTER TABLE hsdg.documents DROP CONSTRAINT IF EXISTS documents_current_version_fk;

DROP TABLE IF EXISTS hsdg.document_versions CASCADE;
DROP TABLE IF EXISTS hsdg.documents CASCADE;
