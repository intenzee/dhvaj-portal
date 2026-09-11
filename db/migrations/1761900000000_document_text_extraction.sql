-- ─────────────────────────────────────────────────────────────────────────
-- 0045 · Document text extraction + full-text search
--
-- Stores the text extracted from a document (via Azure Document Intelligence,
-- when configured) so the portal can (a) full-text search document CONTENTS, not
-- just titles/filenames, and (b) auto-suggest a type and pull key fields
-- (GSTIN, period, …) on upload.
--
--   extracted_text    — the plain text of the current version (null until run).
--   extracted_fields  — key/value fields the extractor pulled (jsonb), plus an
--                       optional __suggestedType hint.
--   extracted_at      — when extraction last succeeded.
--   ocr_status        — pending | done | failed | skipped | disabled.
--   documents_fts     — generated tsvector over title + extracted_text, GIN-indexed,
--                       powering content search. Recomputed automatically on write.
--
-- Extraction is OFF until DOC_AI_* is configured; the columns are harmless when
-- empty (search simply falls back to title/filename). No RLS change: the text
-- rides the documents row's existing engagement-scoped policies.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.documents
  ADD COLUMN extracted_text   text,
  ADD COLUMN extracted_fields jsonb,
  ADD COLUMN extracted_at     timestamptz,
  ADD COLUMN ocr_status       text NOT NULL DEFAULT 'pending'
    CHECK (ocr_status IN ('pending','done','failed','skipped','disabled'));

ALTER TABLE hsdg.documents
  ADD COLUMN documents_fts tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(title, '') || ' ' || coalesce(extracted_text, ''))
    ) STORED;

CREATE INDEX documents_fts_idx ON hsdg.documents USING GIN (documents_fts);

COMMENT ON COLUMN hsdg.documents.extracted_text IS
  'Plain text extracted from the current version (Azure Document Intelligence); powers full-text search.';
COMMENT ON COLUMN hsdg.documents.ocr_status IS
  'Text-extraction state: pending | done | failed | skipped (unsupported type) | disabled (feature off).';

-- Down Migration

DROP INDEX IF EXISTS hsdg.documents_fts_idx;
ALTER TABLE hsdg.documents
  DROP COLUMN IF EXISTS documents_fts,
  DROP COLUMN IF EXISTS ocr_status,
  DROP COLUMN IF EXISTS extracted_at,
  DROP COLUMN IF EXISTS extracted_fields,
  DROP COLUMN IF EXISTS extracted_text;
