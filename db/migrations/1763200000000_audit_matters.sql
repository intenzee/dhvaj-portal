-- ─────────────────────────────────────────────────────────────────────────
-- 0052 · Matters / Exceptions engine  (Implementation Guide §10)
--
-- ONE reusable mechanism for Section 01 (Acceptance Matters) and Section 02
-- (Framework Matters). Matters are GENERATED from adverse answers / overrides /
-- pending facts with a `source` back-link (principle #7 — never re-entered in a
-- separate register). A blocking matter, while open, gates section completion.
--
-- IDEMPOTENCY (§36): UNIQUE (workflow_instance_id, source) — the generator
-- upserts by source, so re-running never duplicates. `seq` is the per-instance
-- counter behind the human `M-00n` code (UNIQUE per instance).
--
-- SECURITY — engagement child data, same assignment-based access as the audit
-- shell and framework tables (1762200000000): members SELECT, only leads
-- (EP/manager) INSERT/UPDATE. ENABLE (not FORCE) RLS so the migrator-owned
-- SECURITY DEFINER helpers bypass; hsdg_app is never the owner.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_matter (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Per-instance sequence behind the display code M-00n.
  seq                    integer NOT NULL,
  section                text NOT NULL CHECK (section IN ('acceptance','framework')),
  -- Back-link key to the originating question/segment/area (idempotency key).
  source                 text NOT NULL CHECK (length(trim(source)) > 0),
  -- Optional originating row (e.g. an assessment id).
  source_ref             uuid,
  title                  text NOT NULL CHECK (length(trim(title)) > 0),
  category               text NOT NULL CHECK (category ~ '^[a-z0-9_]{2,40}$'),
  severity               text CHECK (severity IS NULL OR severity IN ('low','medium','high','critical')),
  is_blocking            boolean NOT NULL DEFAULT false,
  is_auto                boolean NOT NULL DEFAULT true,
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  due_date               date,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN
                           ('open','under_review','resolved','accepted_with_approval','blocking')),
  resolution             text,
  approver_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  approved_at            timestamptz,
  -- Evidence link — points at a document row, never a duplicate copy (§16).
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  note                   text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, source),
  UNIQUE (workflow_instance_id, seq),
  -- Accepting-with-approval must carry the professional's reasoning (§10).
  CONSTRAINT audit_matter_accept_needs_resolution CHECK (
    status <> 'accepted_with_approval'
    OR (resolution IS NOT NULL AND length(trim(resolution)) > 0)
  )
);
CREATE INDEX audit_matter_instance_idx ON hsdg.audit_matter (workflow_instance_id);
CREATE INDEX audit_matter_engagement_idx ON hsdg.audit_matter (engagement_id);
CREATE INDEX audit_matter_open_blocking_idx
  ON hsdg.audit_matter (workflow_instance_id, section)
  WHERE is_blocking = true AND status IN ('open','under_review','blocking');
CREATE TRIGGER audit_matter_set_updated_at
  BEFORE UPDATE ON hsdg.audit_matter
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (mirrors audit_framework_assessments) ───────────────
ALTER TABLE hsdg.audit_matter ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_matter_select ON hsdg.audit_matter
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_matter_insert ON hsdg.audit_matter
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_matter_update ON hsdg.audit_matter
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_matter CASCADE;
