-- ─────────────────────────────────────────────────────────────────────────
-- 0046 · Statutory Audit — PBC Master Client Information Tracker  (SA-6 · §16)
--
-- PBC ("Provided/Prepared By Client") is the client information-request layer,
-- NOT the audit workpaper (§0, §16). It is one master tracker per audit file:
-- each row is a distinct piece of information requested from the client, with a
-- client owner, an agreed due date, a professional status and — crucially — an
-- optional link to the WORK AREA it supports and to the DHVAJ document that was
-- received. When a PBC file is received it is surfaced in the linked work area by
-- reference (§16 — "the same file must not be uploaded again simply to make it
-- visible there"); the document is linked, never duplicated.
--
-- CHANGES:
--   • audit_pbc_items — the master tracker rows. `pbc_ref` (PBC-001, PBC-002 …)
--     is unique per engagement; `status` is the §16 seven-state professional
--     model; a `rejected` item must carry a reason (§16). `work_area_id` is the
--     linked workstream (§16 LINKED WORK); `document_id` is the received file.
--
-- SECURITY — engagement child data, same assignment-based access as the shell
-- and the SA-2..SA-5 tables: members SELECT, only leads (EP/manager)
-- INSERT/UPDATE/DELETE. ENABLE (not FORCE) RLS so the migrator-owned SECURITY
-- DEFINER helpers bypass; hsdg_app is never the owner. No new permission slug
-- (endpoints reuse engagement.read / engagement.manage; RLS gates).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_pbc_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Human-facing master reference (PBC-001…), unique within the engagement (§16).
  pbc_ref                  text NOT NULL CHECK (length(trim(pbc_ref)) > 0),
  -- The information requested from the client (§16 REQUIREMENT).
  requirement              text NOT NULL CHECK (length(trim(requirement)) > 0),
  -- Who on the client side owns the request, e.g. "Finance", "Treasury" (§16).
  client_owner             text,
  -- The work area this request supports (§16 LINKED WORK). Kept if the area is
  -- deactivated so the request's provenance is preserved (SET NULL, never blocked).
  work_area_id             uuid REFERENCES hsdg.audit_work_areas (id) ON DELETE SET NULL,
  -- §16 seven-state professional status model.
  status                   text NOT NULL DEFAULT 'requested' CHECK (status IN
                             ('requested','received','under_review','accepted','rejected',
                              'clarification_required','closed')),
  -- A rejected request is "not usable; reason required" (§16).
  rejection_reason         text,
  -- DATE columns come back as raw 'YYYY-MM-DD' strings (see database/pg-types.ts).
  requested_date           date,
  due_date                 date,
  received_date            date,
  -- The received DHVAJ document (M365/SharePoint metadata); surfaced in the linked
  -- area by reference, never duplicated (§16). Kept if the document goes.
  document_id              uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  note                     text,
  requested_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, pbc_ref),
  CONSTRAINT audit_pbc_rejected_has_reason CHECK (
    status <> 'rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
  )
);
CREATE INDEX audit_pbc_items_instance_idx ON hsdg.audit_pbc_items (workflow_instance_id);
CREATE INDEX audit_pbc_items_engagement_idx ON hsdg.audit_pbc_items (engagement_id);
CREATE INDEX audit_pbc_items_area_idx ON hsdg.audit_pbc_items (work_area_id);
CREATE INDEX audit_pbc_items_document_idx ON hsdg.audit_pbc_items (document_id);
CREATE TRIGGER audit_pbc_items_set_updated_at
  BEFORE UPDATE ON hsdg.audit_pbc_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (mirrors service_workflow_instances) ────────────────
ALTER TABLE hsdg.audit_pbc_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_pbc_items_select ON hsdg.audit_pbc_items
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_pbc_items_insert ON hsdg.audit_pbc_items
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_pbc_items_update ON hsdg.audit_pbc_items
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_pbc_items_delete ON hsdg.audit_pbc_items
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_pbc_items CASCADE;
