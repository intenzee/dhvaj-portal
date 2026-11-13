-- ─────────────────────────────────────────────────────────────────────────
-- Retire service lines whose compliance stream was ended
--
-- WHY: ending a stream on a compliance year (e.g. taking ROC / MCA off
-- 2026-27) only changed the year's streams; the engagement's ROC / MCA service
-- line stayed live, so the engagements list (Service column), the stream leads
-- and the section filters kept showing a service the firm no longer does. The
-- API now cancels such a line when its stream is ended on every open year
-- (EngagementKindsService.retireEndedStreamLines). This repairs the lines left
-- live before that fix. A soft cancel: history is kept, re-adding the stream
-- opens a fresh line. Primary lines and engagements with no open year are left
-- alone. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DO $$
DECLARE
  t text;
  forced text[] := '{}';
BEGIN
  -- The migrator has no request context, so FORCE'd RLS would hide every row
  -- on every table the statements read. Lift it here only, then restore.
  FOREACH t IN ARRAY ARRAY['hsdg.engagement_services', 'hsdg.engagement_components',
                           'hsdg.compliance_engagement_years', 'hsdg.services'] LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      forced := forced || t;
      EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;

  CREATE TEMP TABLE retired_lines ON COMMIT DROP AS
  SELECT es.id
    FROM hsdg.engagement_services es
    JOIN hsdg.services s ON s.id = es.service_id
    LEFT JOIN hsdg.services live ON live.id = s.folded_into_service_id
   WHERE es.status <> 'cancelled' AND NOT es.is_primary
     AND COALESCE(s.stream, live.stream) IS NOT NULL
     AND EXISTS (SELECT 1 FROM hsdg.compliance_engagement_years y
                  WHERE y.engagement_id = es.engagement_id AND y.status = 'open')
     AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_engagement_years y
                      WHERE y.engagement_id = es.engagement_id AND y.status = 'open'
                        AND COALESCE(s.stream, live.stream) = ANY (y.streams));

  UPDATE hsdg.engagement_components c
     SET status = 'cancelled'
   WHERE c.engagement_service_id IN (SELECT id FROM retired_lines)
     AND c.status NOT IN ('completed', 'cancelled', 'superseded');

  UPDATE hsdg.engagement_services
     SET status = 'cancelled'
   WHERE id IN (SELECT id FROM retired_lines);

  FOREACH t IN ARRAY forced LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Down Migration

-- Data repair only; nothing to undo (adding the stream back opens a fresh line).
SELECT 1;
