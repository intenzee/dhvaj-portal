-- ─────────────────────────────────────────────────────────────────────────
-- 0015 · Tasks & Client Dependencies
--
-- Two operational concerns on an engagement, kept distinct so the firm can tell
-- WHOSE delay it is (§11):
--
--   TASKS               — internal work items, assigned to HSDG staff, with due
--                         dates and task→task dependencies. Being past due is an
--                         INTERNAL delay (our responsibility).
--   CLIENT DEPENDENCIES — information requested FROM the client, with request/
--                         reminder/escalation/receipt dates. An open dependency
--                         means the engagement is WAITING FOR CLIENT — a
--                         first-class operational state, derived from open
--                         dependencies rather than folded into the guarded
--                         lifecycle status.
--
-- "Internally overdue" (open task past its due date) and "client delay" (open
-- dependency past its escalation date) are surfaced separately on the
-- engagement read model — the exact §11 distinction.
--
-- Access mirrors the review/compliance engines: engagement-scoped RLS (members
-- read, leads write) — with ONE addition: the assignee of a task may update it
-- even though they are not an engagement lead (a senior/article progresses
-- their own work).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Tasks ──────────────────────────────────────────────────────────────
CREATE TABLE hsdg.tasks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  title                   text NOT NULL CHECK (length(trim(title)) > 0),
  description             text,
  assigned_to_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority                text NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date                date,
  completed_at            timestamptz,
  completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_done_has_completed_at CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
CREATE INDEX tasks_engagement_idx ON hsdg.tasks (engagement_id);
CREATE INDEX tasks_assignee_idx ON hsdg.tasks (assigned_to_employee_id);
-- "Open and overdue" and "open per engagement" are the hot reads.
CREATE INDEX tasks_open_due_idx ON hsdg.tasks (due_date)
  WHERE status NOT IN ('done', 'cancelled');
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON hsdg.tasks
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 2. Task dependencies (a task blocked until another is done) ───────────
CREATE TABLE hsdg.task_dependencies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            uuid NOT NULL REFERENCES hsdg.tasks (id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES hsdg.tasks (id) ON DELETE CASCADE,
  -- Denormalised for RLS (both tasks belong to this engagement; a trigger enforces it).
  engagement_id      uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_dependencies_unique UNIQUE (task_id, depends_on_task_id),
  CONSTRAINT task_dependencies_no_self CHECK (task_id <> depends_on_task_id)
);
CREATE INDEX task_dependencies_task_idx ON hsdg.task_dependencies (task_id);
CREATE INDEX task_dependencies_depends_idx ON hsdg.task_dependencies (depends_on_task_id);

-- Integrity: both tasks must belong to the row's engagement (no cross-engagement
-- dependencies). Plain trigger — tasks are visible to the writer's own context.
CREATE OR REPLACE FUNCTION hsdg.enforce_task_dependency_engagement() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hsdg.tasks t WHERE t.id = NEW.task_id AND t.engagement_id = NEW.engagement_id)
     OR NOT EXISTS (SELECT 1 FROM hsdg.tasks t WHERE t.id = NEW.depends_on_task_id AND t.engagement_id = NEW.engagement_id) THEN
    RAISE EXCEPTION 'A task dependency must link two tasks of the same engagement.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_dependencies_enforce_engagement
  BEFORE INSERT OR UPDATE ON hsdg.task_dependencies
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_task_dependency_engagement();

-- ── 3. Client dependencies (information requested from the client) ─────────
CREATE TABLE hsdg.client_dependencies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  requested_info          text NOT NULL CHECK (length(trim(requested_info)) > 0),
  outstanding_items       text,
  responsible_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  request_date            date NOT NULL DEFAULT CURRENT_DATE,
  reminder_date           date,
  escalation_date         date,
  received_date           date,
  -- Open (waiting for client) = pending | partially_received.
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'partially_received', 'received', 'waived', 'cancelled')),
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_dependencies_received_has_date CHECK (status <> 'received' OR received_date IS NOT NULL)
);
CREATE INDEX client_dependencies_engagement_idx ON hsdg.client_dependencies (engagement_id);
-- Open dependencies drive the waiting-for-client / escalation reads.
CREATE INDEX client_dependencies_open_idx ON hsdg.client_dependencies (engagement_id, escalation_date)
  WHERE status IN ('pending', 'partially_received');
CREATE TRIGGER client_dependencies_set_updated_at BEFORE UPDATE ON hsdg.client_dependencies
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 4. Permissions ────────────────────────────────────────────────────────
-- Reads and lead-writes reuse engagement.read / engagement.manage. One new
-- permission lets a task's ASSIGNEE (who may be a senior/article, without
-- engagement.manage) progress their own task; RLS still scopes it to the
-- assignee-or-lead of that engagement.
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('task.update', 'Update a task you are assigned to (status/progress)');

-- All engagement-working roles (same effective set as engagement.read — the
-- platform admin holds no engagement access and is excluded).
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'task.update'
WHERE r.slug IN ('managing_partner', 'partner', 'manager', 'senior', 'article');

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── 5. Row Level Security ──────────────────────────────────────────────────
-- tasks: members read; leads create/assign/remove; the ASSIGNEE (or a lead) may
-- update — the one departure from the review/compliance "leads write" rule.
ALTER TABLE hsdg.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks FORCE  ROW LEVEL SECURITY;
CREATE POLICY tasks_select ON hsdg.tasks
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY tasks_insert ON hsdg.tasks
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY tasks_update ON hsdg.tasks
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR assigned_to_employee_id = hsdg.ctx_employee_id()
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR assigned_to_employee_id = hsdg.ctx_employee_id()
  );
CREATE POLICY tasks_delete ON hsdg.tasks
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- task_dependencies: members read, leads write.
ALTER TABLE hsdg.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_dependencies FORCE  ROW LEVEL SECURITY;
CREATE POLICY task_dependencies_select ON hsdg.task_dependencies
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY task_dependencies_insert ON hsdg.task_dependencies
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY task_dependencies_delete ON hsdg.task_dependencies
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- client_dependencies: members read, leads write (client-facing governance).
ALTER TABLE hsdg.client_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.client_dependencies FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_dependencies_select ON hsdg.client_dependencies
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY client_dependencies_insert ON hsdg.client_dependencies
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY client_dependencies_update ON hsdg.client_dependencies
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS client_dependencies_update ON hsdg.client_dependencies;
DROP POLICY IF EXISTS client_dependencies_insert ON hsdg.client_dependencies;
DROP POLICY IF EXISTS client_dependencies_select ON hsdg.client_dependencies;
DROP POLICY IF EXISTS task_dependencies_delete ON hsdg.task_dependencies;
DROP POLICY IF EXISTS task_dependencies_insert ON hsdg.task_dependencies;
DROP POLICY IF EXISTS task_dependencies_select ON hsdg.task_dependencies;
DROP POLICY IF EXISTS tasks_delete ON hsdg.tasks;
DROP POLICY IF EXISTS tasks_update ON hsdg.tasks;
DROP POLICY IF EXISTS tasks_insert ON hsdg.tasks;
DROP POLICY IF EXISTS tasks_select ON hsdg.tasks;

DROP TRIGGER IF EXISTS task_dependencies_enforce_engagement ON hsdg.task_dependencies;
DROP FUNCTION IF EXISTS hsdg.enforce_task_dependency_engagement();

DROP TABLE IF EXISTS hsdg.client_dependencies CASCADE;
DROP TABLE IF EXISTS hsdg.task_dependencies CASCADE;
DROP TABLE IF EXISTS hsdg.tasks CASCADE;

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'task.update');
DELETE FROM hsdg.permissions WHERE slug = 'task.update';
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
