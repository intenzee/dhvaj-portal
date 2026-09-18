-- ─────────────────────────────────────────────────────────────────────────
-- 0041 · Statutory Audit — Versioned Workflow Shell  (SA-1 · Audit Spec §5–§8, §33)
--
-- When Statutory Audit (services.code = 'STAT_AUDIT') is added to an engagement,
-- the portal creates a VERSIONED WORKFLOW SHELL — not hundreds of detailed
-- procedures. The shell is the professional audit-file skeleton: ten phases
-- (Acceptance → Framework → Planning → Risk → Controls → Audit Areas →
-- Completion → Reporting → Sign-off → Archive). Detailed work is generated
-- progressively only after framework, planning and risk support it (later SA
-- phases). See Audit Spec §5 ("create the workflow shell but do not create
-- hundreds of detailed procedures") and §37 (versioned workflow shell).
--
-- TWO TABLES:
--   • service_workflow_instances — one shell per engagement_services row
--     (§33 service_workflow_instance). The template/version is STORED HERE so
--     historical files are reproducible even as the methodology evolves (§7:
--     "Workflow/template version must be stored with the service instance").
--   • audit_workflow_phases — the ten navigable phases with professional state
--     (complete / in_progress / not_started / needs_attention / locked — §8).
--
-- IDEMPOTENCY (§20, §36 "Run generation twice → No duplicate objects"): a UNIQUE
-- constraint on engagement_service_id makes provisioning safe to repeat — a
-- second add can never create a second shell. The application provisions via an
-- ON CONFLICT DO NOTHING insert.
--
-- SECURITY MODEL — this is engagement child data, so it rides the SAME
-- assignment-based access as hsdg.engagement_services (see 1757700000000):
--   • any engagement MEMBER can SEE the audit file (team transparency);
--   • only an engagement LEAD (EP / manager) — the exact population that can add
--     a service line — may create or mutate the shell and its phases;
--   • professional history is never hard-deleted by the app (DELETE stays a
--     firm-wide governance action; the tables cascade only with the parent).
-- We reuse the migrator-owned SECURITY DEFINER helpers hsdg.is_engagement_member
-- / hsdg.is_engagement_lead, so the tables run ENABLE (not FORCE) RLS exactly
-- like engagement_services — the helpers bypass RLS internally to avoid
-- recursion, and the least-privilege app role is never the owner.
--
-- No new permission slug: the endpoints reuse engagement.read / engagement.manage
-- (RLS does the real gating), consistent with time tracking and reviews.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── The versioned workflow shell (one per statutory-audit service instance) ─
CREATE TABLE hsdg.service_workflow_instances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One shell per service instance. UNIQUE is the idempotency guarantee (§36).
  engagement_service_id uuid NOT NULL UNIQUE
                          REFERENCES hsdg.engagement_services (id) ON DELETE CASCADE,
  -- Denormalised from the parent for RLS + fast per-engagement lookup (kept
  -- authoritative by the parent FK; never set independently).
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Which professional workflow this shell instantiates (e.g. 'statutory_audit').
  workflow_key          text NOT NULL CHECK (workflow_key ~ '^[a-z0-9_]{2,40}$'),
  -- The methodology/template version FROZEN onto this instance (§7, §37). The
  -- file remains reproducible even after the firm's methodology moves on.
  template_version      text NOT NULL CHECK (length(trim(template_version)) > 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN
                          ('active','on_hold','completed','archived','cancelled')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_workflow_instances_engagement_idx
  ON hsdg.service_workflow_instances (engagement_id);
CREATE INDEX service_workflow_instances_status_idx
  ON hsdg.service_workflow_instances (status);
CREATE TRIGGER service_workflow_instances_set_updated_at
  BEFORE UPDATE ON hsdg.service_workflow_instances
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── The ten audit-file phases (§8) ────────────────────────────────────────
CREATE TABLE hsdg.audit_workflow_phases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id uuid NOT NULL
                         REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  -- Denormalised for RLS + per-engagement queries (kept authoritative by FK).
  engagement_id        uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- 01..10, the professional-file order shown in the left panel.
  phase_no             integer NOT NULL CHECK (phase_no BETWEEN 1 AND 10),
  -- Stable machine key ('acceptance','framework',...), the single source of
  -- truth shared with @hsdg/contracts AUDIT_PHASE.
  phase_key            text NOT NULL CHECK (phase_key ~ '^[a-z0-9_]{2,40}$'),
  title                text NOT NULL CHECK (length(trim(title)) > 0),
  -- Professional state (§8). NOT a task status — locked/needs_attention are
  -- first-class file states, not just "todo/done".
  state                text NOT NULL DEFAULT 'not_started' CHECK (state IN
                         ('complete','in_progress','not_started','needs_attention','locked')),
  sort_order           integer NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Exactly one row per phase per shell — the second idempotency guard.
  UNIQUE (workflow_instance_id, phase_no)
);
CREATE INDEX audit_workflow_phases_instance_idx
  ON hsdg.audit_workflow_phases (workflow_instance_id);
CREATE INDEX audit_workflow_phases_engagement_idx
  ON hsdg.audit_workflow_phases (engagement_id);
CREATE TRIGGER audit_workflow_phases_set_updated_at
  BEFORE UPDATE ON hsdg.audit_workflow_phases
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security ─────────────────────────────────────────────────────
-- ENABLE (not FORCE): the migrator-owned SECURITY DEFINER membership helpers
-- bypass and avoid policy recursion; hsdg_app is never the owner, so it stays
-- governed. Mirrors hsdg.engagement_services exactly.

ALTER TABLE hsdg.service_workflow_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_workflow_instances_select ON hsdg.service_workflow_instances
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY service_workflow_instances_insert ON hsdg.service_workflow_instances
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY service_workflow_instances_update ON hsdg.service_workflow_instances
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_workflow_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_workflow_phases_select ON hsdg.audit_workflow_phases
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_workflow_phases_insert ON hsdg.audit_workflow_phases
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_workflow_phases_update ON hsdg.audit_workflow_phases
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_workflow_phases CASCADE;
DROP TABLE IF EXISTS hsdg.service_workflow_instances CASCADE;
