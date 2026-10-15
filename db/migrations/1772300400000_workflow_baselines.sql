-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · How we measure it — the baseline and the targets.
--
-- workflow_baselines — the six measures frozen for a window of days, for the
-- firm (office_id NULL) or one office. The latest for a scope is the baseline
-- the report compares with. Saved by the managing partner (any scope) or a
-- partner (their office); never edited (save another).
--
-- workflow_measure_targets — one target per measure, set by the partners:
-- at_most / at_least an absolute value, or change_by a percentage on the
-- baseline (−30 = thirty per cent lower). Seeded with the plan's starting points.
-- Both firm-wide; anyone signed in reads them, partners write them.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.workflow_baselines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id        uuid REFERENCES hsdg.offices (id) ON DELETE CASCADE,
  from_day         date NOT NULL,
  to_day           date NOT NULL,
  measures         jsonb NOT NULL CHECK (jsonb_typeof(measures) = 'object'),
  saved_by_user_id uuid NOT NULL DEFAULT hsdg.ctx_user_id() REFERENCES hsdg.users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (to_day >= from_day AND to_day - from_day < 366)
);
CREATE INDEX workflow_baselines_scope_idx
  ON hsdg.workflow_baselines (office_id, created_at DESC);

ALTER TABLE hsdg.workflow_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_baselines_read ON hsdg.workflow_baselines
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
-- A partner sees their office's people, so they baseline their office; the
-- managing partner sees everyone and baselines the firm or any office.
CREATE POLICY workflow_baselines_insert ON hsdg.workflow_baselines
  FOR INSERT WITH CHECK (saved_by_user_id = hsdg.ctx_user_id()
                         AND (hsdg.ctx_role() = 'managing_partner'
                              OR (hsdg.ctx_role() = 'partner'
                                  AND office_id = hsdg.ctx_office_id())));

CREATE TABLE hsdg.workflow_measure_targets (
  measure_key        text PRIMARY KEY CHECK (measure_key IN (
                       'steps_to_first_action', 'exact_link_share', 'review_wait',
                       'filings_past_internal', 'received_to_filed', 'unread_per_user')),
  rule               text NOT NULL CHECK (rule IN ('at_most', 'at_least', 'change_by')),
  value              numeric NOT NULL,
  updated_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (rule <> 'change_by' OR value BETWEEN -100 AND 1000),
  CHECK (rule = 'change_by' OR value >= 0)
);
INSERT INTO hsdg.workflow_measure_targets (measure_key, rule, value) VALUES
  ('steps_to_first_action', 'at_most',   2),
  ('exact_link_share',      'at_least',  90),
  ('review_wait',           'change_by', -30),
  ('filings_past_internal', 'change_by', -25),
  ('received_to_filed',     'change_by', -20),
  ('unread_per_user',       'at_most',   10);

ALTER TABLE hsdg.workflow_measure_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_measure_targets_read ON hsdg.workflow_measure_targets
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY workflow_measure_targets_update ON hsdg.workflow_measure_targets
  FOR UPDATE USING (hsdg.ctx_role() IN ('managing_partner', 'partner'))
  WITH CHECK (hsdg.ctx_role() IN ('managing_partner', 'partner'));

-- Down Migration

DROP TABLE IF EXISTS hsdg.workflow_measure_targets;
DROP TABLE IF EXISTS hsdg.workflow_baselines;
