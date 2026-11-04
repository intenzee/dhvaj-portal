-- Up Migration
--
-- Phase 4, F-5 — the Form 3CD clause workspace. An audit opens its 3CD work
-- on the newest library version published for its year and keeps it. Its
-- clauses fall into work packages; each package is an engagement task, so the
-- Manager or Senior gives it out through Assign work (C-3). Each clause gets
-- one working paper: the answer in the utility's fields, evidence files, the
-- preparer and reviewer, comments and a status. A clause whose condition the
-- audit's facts rule out opens as Not applicable with the library's reason.
-- The standard information list goes to the client as client requests, so the
-- upload links and reminders the portal already has carry it.

ALTER TABLE hsdg.tax_audits
  ADD COLUMN clause_library_version_id uuid
    REFERENCES hsdg.tax_audit_clause_library_versions (id) ON DELETE RESTRICT,
  -- What the audit knows about the assessee (TAX_AUDIT_FACTS keys → boolean).
  ADD COLUMN facts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(facts) = 'object'),
  ADD COLUMN clause_work_opened_at timestamptz;

CREATE TABLE hsdg.tax_audit_clause_packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_audit_id   uuid NOT NULL REFERENCES hsdg.tax_audits (id) ON DELETE CASCADE,
  engagement_id  uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  package        text NOT NULL CHECK (package IN
                   ('general','accounting_methods','stock','depreciation','inadmissible',
                    'cash_payments','msme','statutory_payments','loans_deposits','losses',
                    'tds_tcs','ratios','gst_breakup')),
  grade          text NOT NULL CHECK (grade IN ('article','senior','manager')),
  task_id        uuid UNIQUE REFERENCES hsdg.tasks (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_audit_id, package)
);
CREATE INDEX tax_audit_clause_packages_engagement_idx ON hsdg.tax_audit_clause_packages (engagement_id);

CREATE TABLE hsdg.tax_audit_working_papers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_audit_id             uuid NOT NULL REFERENCES hsdg.tax_audits (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  package_id               uuid NOT NULL REFERENCES hsdg.tax_audit_clause_packages (id) ON DELETE CASCADE,
  library_clause_id        uuid NOT NULL REFERENCES hsdg.tax_audit_clause_library (id) ON DELETE RESTRICT,
  clause_no                text NOT NULL,
  status                   text NOT NULL DEFAULT 'not_started' CHECK (status IN
                             ('not_started','in_progress','in_review','done','not_applicable')),
  -- 'condition': the audit's facts rule the clause out; 'person': someone said so.
  not_applicable_source    text CHECK (not_applicable_source IN ('condition','person')),
  not_applicable_reason    text CHECK (length(not_applicable_reason) <= 1000),
  answer                   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answer) = 'object'),
  preparer_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewer_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- F-6 fills a first draft from portal data; the preparer must confirm it.
  draft_source             text CHECK (draft_source IN
                             ('client_master','tds_filings','gst_filings','last_year','msme_list')),
  draft_answer             jsonb CHECK (draft_answer IS NULL OR jsonb_typeof(draft_answer) = 'object'),
  draft_note               text CHECK (length(draft_note) <= 1000),
  draft_confirmed_at       timestamptz,
  draft_confirmed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  sent_for_review_at       timestamptz,
  done_at                  timestamptz,
  done_by_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  UNIQUE (tax_audit_id, library_clause_id),
  CONSTRAINT tax_audit_wp_not_applicable CHECK (
    (status = 'not_applicable') = (not_applicable_source IS NOT NULL)
    AND (status <> 'not_applicable' OR length(trim(not_applicable_reason)) > 0)),
  CONSTRAINT tax_audit_wp_done CHECK ((status = 'done') = (done_at IS NOT NULL)),
  CONSTRAINT tax_audit_wp_review CHECK (status <> 'in_review' OR sent_for_review_at IS NOT NULL),
  CONSTRAINT tax_audit_wp_draft CHECK (draft_confirmed_at IS NULL OR draft_source IS NOT NULL)
);
CREATE INDEX tax_audit_working_papers_audit_idx ON hsdg.tax_audit_working_papers (tax_audit_id, status);
CREATE INDEX tax_audit_working_papers_package_idx ON hsdg.tax_audit_working_papers (package_id);
CREATE INDEX tax_audit_working_papers_engagement_idx ON hsdg.tax_audit_working_papers (engagement_id);

CREATE TABLE hsdg.tax_audit_working_paper_documents (
  working_paper_id      uuid NOT NULL REFERENCES hsdg.tax_audit_working_papers (id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  added_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  added_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (working_paper_id, document_id)
);
CREATE INDEX tax_audit_wp_documents_engagement_idx ON hsdg.tax_audit_working_paper_documents (engagement_id);

CREATE TABLE hsdg.tax_audit_working_paper_comments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  working_paper_id      uuid NOT NULL REFERENCES hsdg.tax_audit_working_papers (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  author_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  body                  text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tax_audit_wp_comments_paper_idx ON hsdg.tax_audit_working_paper_comments (working_paper_id, created_at);
CREATE INDEX tax_audit_wp_comments_engagement_idx ON hsdg.tax_audit_working_paper_comments (engagement_id);

-- The standard information list rides on the portal's client requests.
ALTER TABLE hsdg.client_dependencies
  ADD COLUMN tax_audit_id uuid REFERENCES hsdg.tax_audits (id) ON DELETE SET NULL,
  ADD COLUMN tax_audit_item text CHECK (length(tax_audit_item) <= 40),
  ADD CONSTRAINT client_dependencies_tax_audit_item
    CHECK ((tax_audit_id IS NULL) = (tax_audit_item IS NULL));
CREATE UNIQUE INDEX client_dependencies_tax_audit_item_idx
  ON hsdg.client_dependencies (tax_audit_id, tax_audit_item) WHERE tax_audit_id IS NOT NULL;

-- Rows of a child table always carry their audit's engagement, which RLS reads.
CREATE FUNCTION hsdg.tax_audit_child_engagement() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  eng uuid;
BEGIN
  IF TG_TABLE_NAME IN ('tax_audit_clause_packages', 'tax_audit_working_papers') THEN
    SELECT engagement_id INTO eng FROM hsdg.tax_audits WHERE id = NEW.tax_audit_id;
  ELSE
    SELECT engagement_id INTO eng FROM hsdg.tax_audit_working_papers WHERE id = NEW.working_paper_id;
  END IF;
  IF eng IS DISTINCT FROM NEW.engagement_id THEN
    RAISE EXCEPTION 'A tax audit''s working rows belong to its engagement.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tax_audit_clause_packages_engagement BEFORE INSERT OR UPDATE ON hsdg.tax_audit_clause_packages
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_child_engagement();
CREATE TRIGGER tax_audit_working_papers_engagement BEFORE INSERT OR UPDATE ON hsdg.tax_audit_working_papers
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_child_engagement();
CREATE TRIGGER tax_audit_wp_documents_engagement BEFORE INSERT OR UPDATE ON hsdg.tax_audit_working_paper_documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_child_engagement();
CREATE TRIGGER tax_audit_wp_comments_engagement BEFORE INSERT OR UPDATE ON hsdg.tax_audit_working_paper_comments
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_child_engagement();
CREATE TRIGGER tax_audit_working_papers_set_updated_at BEFORE UPDATE ON hsdg.tax_audit_working_papers
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

GRANT SELECT, INSERT, UPDATE ON hsdg.tax_audit_clause_packages TO hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.tax_audit_working_papers TO hsdg_app;
GRANT SELECT, INSERT, DELETE ON hsdg.tax_audit_working_paper_documents TO hsdg_app;
GRANT SELECT, INSERT ON hsdg.tax_audit_working_paper_comments TO hsdg_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_audit_clause_packages', 'tax_audit_working_papers',
                           'tax_audit_working_paper_documents', 'tax_audit_working_paper_comments'] LOOP
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE hsdg.%I FORCE ROW LEVEL SECURITY', t);
    -- Whoever works the engagement works its 3CD; the service decides who may do what.
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT TO hsdg_app
                      USING (hsdg.is_engagement_member(engagement_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT TO hsdg_app
                      WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY purge_engagement ON hsdg.%I TO hsdg_migrator
                      USING (current_setting(''hsdg.purging'', true) = ''on'')
                      WITH CHECK (current_setting(''hsdg.purging'', true) = ''on'')', t);
    EXECUTE format('CREATE POLICY erase_person ON hsdg.%I TO hsdg_migrator
                      USING (current_setting(''hsdg.erasing_person'', true) = ''on'')
                      WITH CHECK (current_setting(''hsdg.erasing_person'', true) = ''on'')', t);
  END LOOP;
END;
$$;
CREATE POLICY tax_audit_clause_packages_update ON hsdg.tax_audit_clause_packages FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY tax_audit_working_papers_update ON hsdg.tax_audit_working_papers FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY tax_audit_working_paper_documents_delete ON hsdg.tax_audit_working_paper_documents
  FOR DELETE TO hsdg_app USING (hsdg.is_engagement_member(engagement_id));

-- A package's task follows its clauses, whoever moved them: In progress once
-- one is worked, Done when every one is done or Not applicable, open again if
-- one reopens. The reviewer who marks the last clause done may not be allowed
-- to change the task, so the trigger runs as the owner, through policies that
-- open only while it runs and only on package tasks.
CREATE POLICY tax_audit_task_sync_read ON hsdg.tax_audit_clause_packages FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.tax_audit_task_sync', true) = 'on');
CREATE POLICY tax_audit_task_sync_read ON hsdg.tax_audit_working_papers FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.tax_audit_task_sync', true) = 'on');
CREATE POLICY tax_audit_task_sync_read ON hsdg.tasks FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.tax_audit_task_sync', true) = 'on'
         AND EXISTS (SELECT 1 FROM hsdg.tax_audit_clause_packages p WHERE p.task_id = tasks.id));
CREATE POLICY tax_audit_task_sync_update ON hsdg.tasks FOR UPDATE TO hsdg_migrator
  USING (current_setting('hsdg.tax_audit_task_sync', true) = 'on'
         AND EXISTS (SELECT 1 FROM hsdg.tax_audit_clause_packages p WHERE p.task_id = tasks.id))
  WITH CHECK (current_setting('hsdg.tax_audit_task_sync', true) = 'on'
         AND EXISTS (SELECT 1 FROM hsdg.tax_audit_clause_packages p WHERE p.task_id = tasks.id));

CREATE FUNCTION hsdg.tax_audit_package_task_follows() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  was text := current_setting('hsdg.tax_audit_task_sync', true);
  t uuid;
  total integer;
  settled integer;
  worked integer;
BEGIN
  PERFORM set_config('hsdg.tax_audit_task_sync', 'on', true);
  SELECT p.task_id INTO t FROM hsdg.tax_audit_clause_packages p WHERE p.id = NEW.package_id;
  IF t IS NOT NULL THEN
    SELECT count(*),
           count(*) FILTER (WHERE status IN ('done', 'not_applicable')),
           count(*) FILTER (WHERE status IN ('in_progress', 'in_review', 'done'))
      INTO total, settled, worked
      FROM hsdg.tax_audit_working_papers WHERE package_id = NEW.package_id;
    IF total > 0 AND settled = total THEN
      UPDATE hsdg.tasks
         SET status = 'done', completed_at = now(),
             completed_by_employee_id = hsdg.ctx_employee_id(), version = version + 1
       WHERE id = t AND status NOT IN ('done', 'cancelled');
    ELSIF worked > 0 THEN
      UPDATE hsdg.tasks
         SET status = 'in_progress', completed_at = NULL, completed_by_employee_id = NULL,
             version = version + 1
       WHERE id = t AND status IN ('todo', 'done');
    ELSE
      UPDATE hsdg.tasks
         SET status = 'todo', completed_at = NULL, completed_by_employee_id = NULL,
             version = version + 1
       WHERE id = t AND status = 'done';
    END IF;
  END IF;
  PERFORM set_config('hsdg.tax_audit_task_sync', coalesce(was, ''), true);
  RETURN NULL;
END;
$$;
CREATE TRIGGER tax_audit_working_papers_task_follows
  AFTER INSERT OR UPDATE OF status ON hsdg.tax_audit_working_papers
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_package_task_follows();

-- Down Migration

DROP POLICY tax_audit_task_sync_update ON hsdg.tasks;
DROP POLICY tax_audit_task_sync_read ON hsdg.tasks;

DROP INDEX hsdg.client_dependencies_tax_audit_item_idx;
ALTER TABLE hsdg.client_dependencies
  DROP CONSTRAINT client_dependencies_tax_audit_item,
  DROP COLUMN tax_audit_item,
  DROP COLUMN tax_audit_id;
DROP TABLE hsdg.tax_audit_working_paper_comments;
DROP TABLE hsdg.tax_audit_working_paper_documents;
DROP TABLE hsdg.tax_audit_working_papers;
DROP TABLE hsdg.tax_audit_clause_packages;
DROP FUNCTION hsdg.tax_audit_child_engagement();
DROP FUNCTION hsdg.tax_audit_package_task_follows();
ALTER TABLE hsdg.tax_audits
  DROP COLUMN clause_work_opened_at,
  DROP COLUMN facts,
  DROP COLUMN clause_library_version_id;
