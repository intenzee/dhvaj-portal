-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · Rollout: each phase's flag, office by office, from the portal
--
-- FEATURE_FLAGS (the deploy) stays the master switch: a flag the deploy leaves
-- off stays off. Within it, Admin → Rollout decides where a deployed flag is on:
--   firm     — every office
--   offices  — only the listed office codes (the pilot)
--   off      — paused everywhere, without a deploy
-- No row ⇒ the deploy's own FEATURE_FLAG_OFFICES, as before. The API caches
-- these rows and re-reads them after each change and every 30 seconds.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.feature_rollouts (
  flag                   text PRIMARY KEY CHECK (flag ~ '^ff_[a-z0-9_]{1,60}$'),
  mode                   text NOT NULL CHECK (mode IN ('firm', 'offices', 'off')),
  office_codes           text[] NOT NULL DEFAULT '{}',
  note                   text CHECK (note IS NULL OR length(note) <= 500),
  version                integer NOT NULL DEFAULT 1,
  updated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (mode <> 'offices' OR cardinality(office_codes) > 0)
);

-- Everyone's flags are worked out from these rows (the system context reads
-- them at boot); only the managing partner and the firm admin change them.
ALTER TABLE hsdg.feature_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.feature_rollouts FORCE ROW LEVEL SECURITY;
CREATE POLICY feature_rollouts_read ON hsdg.feature_rollouts
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY feature_rollouts_write ON hsdg.feature_rollouts
  FOR ALL USING (hsdg.ctx_role() IN ('managing_partner', 'admin'))
  WITH CHECK (hsdg.ctx_role() IN ('managing_partner', 'admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.feature_rollouts TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.feature_rollouts;
