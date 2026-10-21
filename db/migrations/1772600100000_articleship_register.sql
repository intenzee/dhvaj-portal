-- ─────────────────────────────────────────────────────────────────────────
-- HR role · the articleship register (spec docs/accountant-hr-roles-spec.md
-- §4.2, §4.7).
--
-- articleship_schemes — the firm's settings per ICAI training scheme: period
--                 in months and the leave the firm allows over the whole
--                 period. Kept as settings, not hard-coded, because the ICAI
--                 limits differ by scheme and change; the leave is blank until
--                 the firm enters it.
-- articleships  — one articleship per article: principal (a partner),
--                 ICAI registration number and date, scheme, start and
--                 expected completion, and how it ended (completed,
--                 transferred out, terminated). A transfer in records where
--                 the article came from. One active articleship per person.
-- articleship_leaves — leave taken against the entitlement (leave, exam,
--                 sick, other), in days.
--
-- Access (FORCE RLS): HR and the Managing Partner read and write; the article
-- and their principal read their own.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.articleship_schemes (
  code                   text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label                  text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  period_months          integer NOT NULL CHECK (period_months BETWEEN 1 AND 120),
  -- Leave allowed over the whole period; null until the firm enters it.
  leave_entitlement_days integer CHECK (leave_entitlement_days IS NULL OR leave_entitlement_days >= 0),
  is_active              boolean NOT NULL DEFAULT true,
  sort_order             integer NOT NULL DEFAULT 0,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER articleship_schemes_set_updated_at BEFORE UPDATE ON hsdg.articleship_schemes
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

INSERT INTO hsdg.articleship_schemes (code, label, period_months, sort_order) VALUES
  ('three_year', 'Three years', 36, 1),
  ('two_year',   'Two years',   24, 2);

CREATE TABLE hsdg.articleships (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  principal_employee_id   uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  scheme_code             text NOT NULL REFERENCES hsdg.articleship_schemes (code),
  icai_registration_no    text CHECK (icai_registration_no IS NULL
                                      OR length(trim(icai_registration_no)) BETWEEN 1 AND 40),
  icai_registration_date  date,
  start_date              date NOT NULL,
  expected_completion     date NOT NULL,
  -- This article's own allowance, when it differs from the scheme's.
  leave_entitlement_days  integer CHECK (leave_entitlement_days IS NULL OR leave_entitlement_days >= 0),
  -- Where they came from, when transferred in from another principal.
  transferred_from        text CHECK (transferred_from IS NULL OR length(transferred_from) <= 300),
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','completed','transferred_out','terminated')),
  ended_on                date,
  end_note                text CHECK (end_note IS NULL OR length(end_note) <= 1000),
  version                 integer NOT NULL DEFAULT 1,
  created_by_user_id      uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articleship_completion_after_start CHECK (expected_completion > start_date),
  CONSTRAINT articleship_ended_shape CHECK ((status = 'active') = (ended_on IS NULL)),
  CONSTRAINT articleship_ended_after_start CHECK (ended_on IS NULL OR ended_on >= start_date),
  CONSTRAINT articleship_not_own_principal CHECK (principal_employee_id <> employee_id)
);
CREATE UNIQUE INDEX articleships_one_active ON hsdg.articleships (employee_id) WHERE status = 'active';
CREATE INDEX articleships_principal_idx ON hsdg.articleships (principal_employee_id);
CREATE INDEX articleships_completion_idx ON hsdg.articleships (expected_completion) WHERE status = 'active';
CREATE TRIGGER articleships_set_updated_at BEFORE UPDATE ON hsdg.articleships
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.articleship_leaves (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articleship_id     uuid NOT NULL REFERENCES hsdg.articleships (id) ON DELETE CASCADE,
  from_date          date NOT NULL,
  to_date            date NOT NULL,
  days               numeric(5,1) NOT NULL CHECK (days > 0 AND days <= 366),
  kind               text NOT NULL CHECK (kind IN ('leave','exam','sick','other')),
  note               text CHECK (note IS NULL OR length(note) <= 500),
  created_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articleship_leave_order CHECK (to_date >= from_date)
);
CREATE INDEX articleship_leaves_articleship_idx ON hsdg.articleship_leaves (articleship_id, from_date);

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE hsdg.articleship_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.articleship_schemes FORCE ROW LEVEL SECURITY;
CREATE POLICY articleship_schemes_select ON hsdg.articleship_schemes FOR SELECT TO hsdg_app
  USING (true);
CREATE POLICY articleship_schemes_write ON hsdg.articleship_schemes FOR UPDATE TO hsdg_app
  USING (hsdg.ctx_reads_people()) WITH CHECK (hsdg.ctx_reads_people());
CREATE POLICY articleship_schemes_owner ON hsdg.articleship_schemes TO hsdg_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON hsdg.articleship_schemes TO hsdg_app;

ALTER TABLE hsdg.articleships ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.articleships FORCE ROW LEVEL SECURITY;
CREATE POLICY articleships_select ON hsdg.articleships FOR SELECT TO hsdg_app
  USING (hsdg.ctx_reads_people()
         OR employee_id = hsdg.ctx_employee_id()
         OR principal_employee_id = hsdg.ctx_employee_id());
CREATE POLICY articleships_insert ON hsdg.articleships FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_reads_people());
CREATE POLICY articleships_update ON hsdg.articleships FOR UPDATE TO hsdg_app
  USING (hsdg.ctx_reads_people()) WITH CHECK (hsdg.ctx_reads_people());
CREATE POLICY articleships_owner ON hsdg.articleships TO hsdg_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.articleships TO hsdg_app;

ALTER TABLE hsdg.articleship_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.articleship_leaves FORCE ROW LEVEL SECURITY;
CREATE POLICY articleship_leaves_select ON hsdg.articleship_leaves FOR SELECT TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.articleships a WHERE a.id = articleship_id));
CREATE POLICY articleship_leaves_insert ON hsdg.articleship_leaves FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_reads_people());
CREATE POLICY articleship_leaves_delete ON hsdg.articleship_leaves FOR DELETE TO hsdg_app
  USING (hsdg.ctx_reads_people());
CREATE POLICY articleship_leaves_owner ON hsdg.articleship_leaves TO hsdg_migrator
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON hsdg.articleship_leaves TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.articleship_leaves;
DROP TABLE IF EXISTS hsdg.articleships;
DROP TABLE IF EXISTS hsdg.articleship_schemes;
