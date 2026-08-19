-- ─────────────────────────────────────────────────────────────────────────
-- 0011 · Engagement Lifecycle & Workflow Engine
--
-- Replaces the unrestricted `PATCH /engagements/:id { status }` path with a
-- controlled, auditable, configurable state-transition architecture. Four
-- distinct concepts, kept separate (see ADR-0011):
--
--   A. ENGAGEMENT LIFECYCLE  — governance/commercial state (this migration)
--   B. SERVICE WORKFLOW      — how the professional work is performed
--                               (foundation only: an engagement-level
--                               workflow-state instance + transitions)
--   C. REVIEW STATE          — Phase 7
--   D. COMPLIANCE STATE      — Phase 8
--
-- Configuration defines WHAT transitions exist (the two transition tables
-- below); application code decides whether a given transition is legally
-- executable right now (guards) — security rules are never purely
-- data-driven (see ADR-0011 §"transition guards").
--
-- Audit-workflow reconciliation (checkpoint finding, see ADR-0011): the
-- Phase 4 seed had one generic "review" state. The firm's actual audit
-- practice distinguishes Manager Review from EP Review, so this migration
-- splits it: planning → fieldwork → manager_review → ep_review → ep_sign_off
-- → completed. No engagement referenced a specific workflow_state row before
-- this migration (the column doesn't exist until below), so the rename/split
-- is safe. Whether a given audit actually requires EP Review remains a
-- Phase 7 (review model) decision — the workflow engine does not hard-code it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Audit-workflow reconciliation ───────────────────────────────────────
-- workflow_states/workflow_families already run FORCE ROW LEVEL SECURITY
-- (Phase 4). The migrator carries no `hsdg.role` context, so under FORCE it
-- would silently see/affect zero rows here (not an error — a no-op). Same
-- reference-data pattern as migration 0009: drop FORCE, do the work, restore.
ALTER TABLE hsdg.workflow_families NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states   NO FORCE ROW LEVEL SECURITY;

-- Two-step renumber to dodge the (workflow_family_id, sequence) unique index:
-- push ep_sign_off/completed out of the way, split "review", then land them.

UPDATE hsdg.workflow_states SET sequence = sequence + 100
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug IN ('ep_sign_off', 'completed');

UPDATE hsdg.workflow_states SET slug = 'manager_review', name = 'Manager Review', sequence = 3
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug = 'review';

INSERT INTO hsdg.workflow_states (workflow_family_id, slug, name, sequence, is_initial, is_terminal)
SELECT id, 'ep_review', 'EP Review', 4, false, false
FROM hsdg.workflow_families WHERE slug = 'audit_workflow';

UPDATE hsdg.workflow_states SET sequence = 5
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug = 'ep_sign_off';
UPDATE hsdg.workflow_states SET sequence = 6
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug = 'completed';

-- ── 2. Lifecycle transitions (config: what transitions exist) ─────────────

CREATE TABLE hsdg.engagement_lifecycle_transitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]{1,40}$'),
  from_status   text NOT NULL CHECK (from_status IN
                   ('prospect','pending_acceptance','accepted','active','on_hold',
                    'completed','closed','declined','withdrawn','cancelled')),
  -- NULL only for 'resume': its destination is dynamic (the engagement's own
  -- on_hold_previous_status), resolved in application code, never in config.
  to_status     text CHECK (to_status IS NULL OR to_status IN
                   ('prospect','pending_acceptance','accepted','active','on_hold',
                    'completed','closed','declined','withdrawn','cancelled')),
  display_name  text NOT NULL,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_lifecycle_transitions_unique UNIQUE (action, from_status),
  CONSTRAINT engagement_lifecycle_transitions_dynamic_resume CHECK (
    to_status IS NOT NULL OR action = 'resume'
  )
);
CREATE INDEX engagement_lifecycle_transitions_from_idx
  ON hsdg.engagement_lifecycle_transitions (from_status);
CREATE TRIGGER engagement_lifecycle_transitions_set_updated_at
  BEFORE UPDATE ON hsdg.engagement_lifecycle_transitions
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

INSERT INTO hsdg.engagement_lifecycle_transitions
  (action, from_status, to_status, display_name, sort_order) VALUES
  ('submit_for_acceptance', 'prospect',           'pending_acceptance', 'Submit for Acceptance', 10),
  ('cancel',                'prospect',           'cancelled',          'Cancel',                11),
  ('accept',                'pending_acceptance', 'accepted',           'Accept',                20),
  ('decline',               'pending_acceptance', 'declined',           'Decline',               21),
  ('cancel',                'pending_acceptance', 'cancelled',          'Cancel',                22),
  ('start',                 'accepted',           'active',             'Start',                 30),
  ('withdraw',              'accepted',           'withdrawn',          'Withdraw',              31),
  ('put_on_hold',           'active',             'on_hold',            'Put On Hold',           40),
  ('complete',              'active',             'completed',          'Complete',              41),
  ('withdraw',              'active',             'withdrawn',          'Withdraw',              42),
  ('resume',                'on_hold',            NULL,                 'Resume',                50),
  ('close',                 'completed',          'closed',             'Close',                 60),
  ('reopen',                'completed',          'active',             'Reopen',                61),
  ('reopen',                'closed',             'active',             'Reopen',                70);

-- ── 3. Service-workflow transitions (config: what workflow moves exist) ───
-- Foundation only: one generic 'advance' action between consecutive states in
-- a family's own sequence. Branching/skip logic (the review DAG) is Phase 7.

CREATE TABLE hsdg.workflow_transitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_family_id uuid NOT NULL REFERENCES hsdg.workflow_families (id) ON DELETE CASCADE,
  from_state_id      uuid NOT NULL REFERENCES hsdg.workflow_states (id) ON DELETE CASCADE,
  to_state_id        uuid NOT NULL REFERENCES hsdg.workflow_states (id) ON DELETE CASCADE,
  action             text NOT NULL DEFAULT 'advance' CHECK (action ~ '^[a-z][a-z0-9_]{1,40}$'),
  display_name       text NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_transitions_unique UNIQUE (workflow_family_id, from_state_id, action),
  CONSTRAINT workflow_transitions_no_self CHECK (from_state_id <> to_state_id)
);
CREATE INDEX workflow_transitions_family_idx ON hsdg.workflow_transitions (workflow_family_id);
CREATE INDEX workflow_transitions_from_idx ON hsdg.workflow_transitions (from_state_id);
CREATE TRIGGER workflow_transitions_set_updated_at BEFORE UPDATE ON hsdg.workflow_transitions
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- One 'advance' edge per consecutive (sequence, sequence+1) pair, in every
-- family — driven entirely by the states already seeded, so this needed no
-- per-family hard-coding and stays correct after the reconciliation above.
INSERT INTO hsdg.workflow_transitions (workflow_family_id, from_state_id, to_state_id, action, display_name)
SELECT s1.workflow_family_id, s1.id, s2.id, 'advance', 'Advance to ' || s2.name
FROM hsdg.workflow_states s1
JOIN hsdg.workflow_states s2
  ON s2.workflow_family_id = s1.workflow_family_id AND s2.sequence = s1.sequence + 1;

-- Restore FORCE now that the reconciliation + seed reads above are done.
ALTER TABLE hsdg.workflow_states   FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families FORCE ROW LEVEL SECURITY;

-- ── 4. Lifecycle history (the business journey; distinct from audit_events) ─

CREATE TABLE hsdg.engagement_lifecycle_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id      uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  action             text NOT NULL,
  from_status        text NOT NULL,
  to_status          text NOT NULL,
  actor_user_id      uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  actor_role         text,
  reason             text,
  correlation_id     text,
  previous_version   integer NOT NULL,
  resulting_version  integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_lifecycle_history_engagement_idx
  ON hsdg.engagement_lifecycle_history (engagement_id, created_at DESC);

-- ── 5. Engagement columns: workflow-state instance + on-hold bookkeeping ──

ALTER TABLE hsdg.engagements
  ADD COLUMN current_workflow_state_id uuid REFERENCES hsdg.workflow_states (id) ON DELETE RESTRICT,
  ADD COLUMN on_hold_reason text,
  ADD COLUMN on_hold_previous_status text,
  ADD COLUMN on_hold_at timestamptz,
  ADD COLUMN on_hold_expected_resume_date date;

CREATE INDEX engagements_workflow_state_idx ON hsdg.engagements (current_workflow_state_id);

ALTER TABLE hsdg.engagements ADD CONSTRAINT engagements_on_hold_requires_previous CHECK (
  status <> 'on_hold' OR on_hold_previous_status IS NOT NULL
);

-- Data-integrity guard: the workflow state must belong to the workflow family
-- of the engagement's own service. A plain (non-SECURITY DEFINER) trigger
-- suffices — it runs as whoever fired the UPDATE, inside their own already-
-- open transaction, and hsdg.services / hsdg.workflow_states are firm-wide
-- readable to any authenticated context (unlike the engagement-grade check,
-- there is no cross-office visibility gap to bridge here).
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_workflow_state() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_workflow_state_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.current_workflow_state_id IS DISTINCT FROM OLD.current_workflow_state_id
          OR NEW.service_id IS DISTINCT FROM OLD.service_id)
     AND NOT EXISTS (
       SELECT 1 FROM hsdg.workflow_states ws
       JOIN hsdg.services s ON s.workflow_family_id = ws.workflow_family_id
       WHERE ws.id = NEW.current_workflow_state_id AND s.id = NEW.service_id
     ) THEN
    RAISE EXCEPTION 'current_workflow_state_id must belong to the workflow family of the engagement''s service.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagements_enforce_workflow_state
  BEFORE INSERT OR UPDATE ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_workflow_state();

-- ── 6. Grants ───────────────────────────────────────────────────────────
-- Transition tables are migration-managed reference config, like
-- workflow_states/review_models: any authenticated role reads, nobody writes
-- at runtime. Lifecycle history is append-only, like audit_events.

REVOKE INSERT, UPDATE, DELETE ON hsdg.engagement_lifecycle_transitions FROM hsdg_app;
REVOKE INSERT, UPDATE, DELETE ON hsdg.workflow_transitions            FROM hsdg_app;
REVOKE UPDATE, DELETE          ON hsdg.engagement_lifecycle_history   FROM hsdg_app;

-- ── 7. Row Level Security ──────────────────────────────────────────────────

ALTER TABLE hsdg.engagement_lifecycle_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_lifecycle_transitions FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_lifecycle_transitions_read ON hsdg.engagement_lifecycle_transitions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

ALTER TABLE hsdg.workflow_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_transitions FORCE  ROW LEVEL SECURITY;
CREATE POLICY workflow_transitions_read ON hsdg.workflow_transitions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

-- Lifecycle history is engagement-scoped, not firm-wide config: visible only
-- via the same assignment (EP/manager/team) that grants access to the
-- engagement itself — never independent of it. Insert is scoped to the lead
-- floor (matches engagements_update's USING clause): only whoever could
-- legally mutate the engagement row can leave a history entry for it.
ALTER TABLE hsdg.engagement_lifecycle_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_lifecycle_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_lifecycle_history_select ON hsdg.engagement_lifecycle_history
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_lifecycle_history_insert ON hsdg.engagement_lifecycle_history
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS engagement_lifecycle_history_insert ON hsdg.engagement_lifecycle_history;
DROP POLICY IF EXISTS engagement_lifecycle_history_select ON hsdg.engagement_lifecycle_history;
DROP POLICY IF EXISTS workflow_transitions_read ON hsdg.workflow_transitions;
DROP POLICY IF EXISTS engagement_lifecycle_transitions_read ON hsdg.engagement_lifecycle_transitions;

DROP TRIGGER IF EXISTS engagements_enforce_workflow_state ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.enforce_engagement_workflow_state();

ALTER TABLE hsdg.engagements DROP CONSTRAINT IF EXISTS engagements_on_hold_requires_previous;
DROP INDEX IF EXISTS hsdg.engagements_workflow_state_idx;
ALTER TABLE hsdg.engagements
  DROP COLUMN IF EXISTS on_hold_expected_resume_date,
  DROP COLUMN IF EXISTS on_hold_at,
  DROP COLUMN IF EXISTS on_hold_previous_status,
  DROP COLUMN IF EXISTS on_hold_reason,
  DROP COLUMN IF EXISTS current_workflow_state_id;

DROP TABLE IF EXISTS hsdg.engagement_lifecycle_history CASCADE;
DROP TABLE IF EXISTS hsdg.workflow_transitions CASCADE;
DROP TABLE IF EXISTS hsdg.engagement_lifecycle_transitions CASCADE;

-- Reverse the audit-workflow reconciliation: consolidate manager_review +
-- ep_review back into a single 'review' state. Same FORCE-toggle as Up §1.
ALTER TABLE hsdg.workflow_families NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states   NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.workflow_states
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug = 'ep_review';

UPDATE hsdg.workflow_states SET sequence = sequence + 100
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug IN ('ep_sign_off', 'completed');

UPDATE hsdg.workflow_states SET slug = 'review', name = 'Review', sequence = 3
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug = 'manager_review';

UPDATE hsdg.workflow_states SET sequence = 4
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug = 'ep_sign_off';
UPDATE hsdg.workflow_states SET sequence = 5
WHERE workflow_family_id = (SELECT id FROM hsdg.workflow_families WHERE slug = 'audit_workflow')
  AND slug = 'completed';

ALTER TABLE hsdg.workflow_states   FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families FORCE ROW LEVEL SECURITY;
