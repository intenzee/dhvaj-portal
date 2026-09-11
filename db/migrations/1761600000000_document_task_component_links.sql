-- ─────────────────────────────────────────────────────────────────────────
-- 0042 · Club documents with the work they belong to (task / component instance)
--
-- Until now a document was scoped only to its engagement. To let the portal
-- open documents *inside the work* — "show me only the GST papers for Sep 2026",
-- or "the documents attached to this task" — a document may now optionally point
-- at:
--
--   • a TASK (hsdg.tasks)                — ad-hoc engagement work, and/or
--   • a COMPONENT INSTANCE (hsdg.component_instances) — a recurring period's
--     work item (e.g. the GST return for a given month).
--
-- Both are NULLABLE: an engagement-level document (not tied to a specific work
-- item) keeps both null, exactly as today.
--
-- ON DELETE SET NULL: if a task or component instance is removed, its documents
-- survive (they fall back to engagement scope) rather than cascading away —
-- evidence is never destroyed by re-scoping work. Single-column FKs are used
-- deliberately: a composite (id, engagement_id) FK with SET NULL would also null
-- the document's NOT NULL engagement_id. Same-engagement integrity (a document
-- may only be filed under work in its OWN engagement) is enforced in the
-- application layer (DocumentsService validates the link on write).
--
-- SECURITY — no RLS change is needed. Access still inherits the engagement (the
-- existing documents policies); these columns only narrow WHICH documents a
-- member sees, never widen access.
--
-- SOFT DELETE (§20 keeps professional evidence): the firm never hard-deletes
-- working papers, so "delete" is a reversible soft state, not a physical DELETE
-- (which stays revoked at the grant level). `deleted_at` hides a document from
-- every list/view for everyone; a managing partner can restore it. The row,
-- its version chain and its audit trail are all retained. This is written via
-- the existing UPDATE path, so no grant/RLS change is needed — and only the
-- managing partner (business-firm-wide) may set/clear it (enforced in the app
-- layer; RLS already limits UPDATE to engagement leads / the managing partner).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.documents
  ADD COLUMN task_id uuid REFERENCES hsdg.tasks (id) ON DELETE SET NULL,
  ADD COLUMN component_instance_id uuid
    REFERENCES hsdg.component_instances (id) ON DELETE SET NULL,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL;

CREATE INDEX documents_task_id_idx ON hsdg.documents (task_id)
  WHERE task_id IS NOT NULL;
CREATE INDEX documents_component_instance_id_idx ON hsdg.documents (component_instance_id)
  WHERE component_instance_id IS NOT NULL;
-- Fast "live documents" scans (the default list excludes soft-deleted rows).
CREATE INDEX documents_not_deleted_idx ON hsdg.documents (engagement_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN hsdg.documents.deleted_at IS
  'When set, the document is soft-deleted: hidden from every list/view; retained for audit; restorable by a managing partner. §20 (evidence is never hard-deleted).';
COMMENT ON COLUMN hsdg.documents.task_id IS
  'Optional task this document is filed under (same engagement); null = engagement-level.';
COMMENT ON COLUMN hsdg.documents.component_instance_id IS
  'Optional component-work period (e.g. GST for a month) this document is filed under (same engagement); null = engagement-level.';

-- Down Migration

DROP INDEX IF EXISTS hsdg.documents_not_deleted_idx;
DROP INDEX IF EXISTS hsdg.documents_component_instance_id_idx;
DROP INDEX IF EXISTS hsdg.documents_task_id_idx;

ALTER TABLE hsdg.documents
  DROP COLUMN IF EXISTS deleted_by_employee_id,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS component_instance_id,
  DROP COLUMN IF EXISTS task_id;
