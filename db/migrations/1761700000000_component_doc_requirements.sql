-- ─────────────────────────────────────────────────────────────────────────
-- 0043 · Required-documents checklist per service component
--
-- Turns "what's left" into "what's MISSING": a firm-configurable list of the
-- documents each service component expects (e.g. GST → GSTR-1, GSTR-3B, purchase
-- register). The component-work grid can then flag any period missing mandatory
-- evidence, and the per-period documents pop-up shows a satisfied/missing
-- checklist.
--
--   service_component_doc_requirements — catalogue config: one row per expected
--     document type, per service component. Firm-wide readable; only firm-wide
--     authority (managing partner / admin / system, via service.manage) writes —
--     mirrors service_components exactly.
--
-- A document satisfies a requirement when it is uploaded against a specific
-- component-work period (documents.component_instance_id) AND tagged with the
-- requirement (documents.doc_requirement_id, added here). One requirement can be
-- satisfied by many documents; a document may satisfy at most one requirement.
-- ON DELETE SET NULL: retiring a requirement never destroys the evidence filed
-- under it (the document simply loses the tag).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.service_component_doc_requirements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_component_id uuid NOT NULL REFERENCES hsdg.service_components (id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (length(trim(name)) > 0),
  description          text,
  is_mandatory         boolean NOT NULL DEFAULT true,
  display_order        integer NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_component_doc_requirements_unique UNIQUE (service_component_id, name)
);
CREATE INDEX service_component_doc_requirements_component_idx
  ON hsdg.service_component_doc_requirements (service_component_id);
CREATE TRIGGER service_component_doc_requirements_set_updated_at
  BEFORE UPDATE ON hsdg.service_component_doc_requirements
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Tag a document as satisfying a specific checklist requirement.
ALTER TABLE hsdg.documents
  ADD COLUMN doc_requirement_id uuid
    REFERENCES hsdg.service_component_doc_requirements (id) ON DELETE SET NULL;
CREATE INDEX documents_doc_requirement_id_idx ON hsdg.documents (doc_requirement_id)
  WHERE doc_requirement_id IS NOT NULL;

COMMENT ON TABLE hsdg.service_component_doc_requirements IS
  'Firm-configurable checklist of documents each service component expects; drives the missing-evidence flag on component work.';
COMMENT ON COLUMN hsdg.documents.doc_requirement_id IS
  'Optional checklist requirement this document satisfies (same component as its component_instance); null = not tagged.';

-- RLS mirrors service_components: any authenticated role reads; firm-wide writes.
ALTER TABLE hsdg.service_component_doc_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_component_doc_requirements FORCE  ROW LEVEL SECURITY;
CREATE POLICY service_component_doc_requirements_read
  ON hsdg.service_component_doc_requirements
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY service_component_doc_requirements_write
  ON hsdg.service_component_doc_requirements
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- Down Migration

DROP POLICY IF EXISTS service_component_doc_requirements_write ON hsdg.service_component_doc_requirements;
DROP POLICY IF EXISTS service_component_doc_requirements_read ON hsdg.service_component_doc_requirements;

DROP INDEX IF EXISTS hsdg.documents_doc_requirement_id_idx;
ALTER TABLE hsdg.documents DROP COLUMN IF EXISTS doc_requirement_id;

DROP TABLE IF EXISTS hsdg.service_component_doc_requirements CASCADE;
