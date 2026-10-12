-- ─────────────────────────────────────────────────────────────────────────
-- Independence facts (spec Change 1, "Independence and conflict rules").
--
-- The s.144 / s.44AB checks must see every engagement the firm holds for the
-- client — including ones the person creating an engagement is not on, which
-- engagements_select hides from them. Every function here is owned by
-- hsdg_migrator, itself subject to FORCE ROW LEVEL SECURITY, so a SECURITY
-- DEFINER read of hsdg.engagements would not see past the caller's policies.
--
-- So the few facts the rules need are kept in their own narrow table, which
-- only hsdg_migrator-owned code can touch:
--   statutory_audit  an open Statutory Audit for that FY
--   compliance       the open Compliance engagement (FY = its commencement)
--   bookkeeping/mis  that stream in scope on a Compliance year
--   internal_audit / tax_audit   an open assignment carrying INT_AUDIT / TAX_AUDIT
-- The facts are written by triggers on engagements, engagement_services and
-- compliance_engagement_years (computed as the writer, who sees what they
-- change; a superuser seed sees everything), and read through
-- entity_independence_facts(), gated on the caller seeing the client.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.engagement_independence_facts (
  engagement_id   uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  engagement_code text NOT NULL,
  financial_year  text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  fact            text NOT NULL CHECK (fact IN
                    ('statutory_audit','compliance','bookkeeping','mis','internal_audit','tax_audit')),
  PRIMARY KEY (engagement_id, financial_year, fact)
);
CREATE INDEX engagement_independence_facts_entity_idx
  ON hsdg.engagement_independence_facts (entity_id, financial_year);

REVOKE ALL ON hsdg.engagement_independence_facts FROM PUBLIC;
REVOKE ALL ON hsdg.engagement_independence_facts FROM hsdg_app;
ALTER TABLE hsdg.engagement_independence_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_independence_facts FORCE  ROW LEVEL SECURITY;
-- Only the owner's functions below read or write it.
CREATE POLICY engagement_independence_facts_owner ON hsdg.engagement_independence_facts
  TO hsdg_migrator USING (true) WITH CHECK (true);

-- Replace one engagement's facts. Callable only from inside a trigger, so the
-- application cannot write facts directly.
CREATE FUNCTION hsdg.put_independence_facts(eng_id uuid, ent_id uuid, code text, facts jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() < 1 THEN
    RAISE EXCEPTION 'Independence facts are maintained by triggers only.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM hsdg.engagement_independence_facts WHERE engagement_id = eng_id;
  INSERT INTO hsdg.engagement_independence_facts
         (engagement_id, entity_id, engagement_code, financial_year, fact)
  SELECT DISTINCT eng_id, ent_id, code, f->>'fy', f->>'fact'
    FROM jsonb_array_elements(facts) f;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.put_independence_facts(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.put_independence_facts(uuid, uuid, text, jsonb) TO hsdg_app;

-- Recompute one engagement's facts, as the caller (invoker): the writer of an
-- engagement, its lines or its years can see them.
CREATE FUNCTION hsdg.sync_independence_facts(eng_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = hsdg, pg_temp
AS $$
DECLARE
  e record;
  facts jsonb := '[]'::jsonb;
BEGIN
  SELECT id, entity_id, engagement_code, kind, status, financial_year, service_id
    INTO e FROM hsdg.engagements WHERE id = eng_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF e.status NOT IN ('closed','merged','cancelled','declined','withdrawn') THEN
    IF e.kind = 'statutory_audit' THEN
      facts := jsonb_build_array(jsonb_build_object('fy', e.financial_year, 'fact', 'statutory_audit'));
    ELSIF e.kind = 'compliance' THEN
      facts := jsonb_build_array(jsonb_build_object('fy', e.financial_year, 'fact', 'compliance'))
        || COALESCE((
             SELECT jsonb_agg(jsonb_build_object('fy', y.financial_year, 'fact', s))
               FROM hsdg.compliance_engagement_years y
               CROSS JOIN LATERAL unnest(y.streams) AS s
              WHERE y.engagement_id = eng_id AND s IN ('bookkeeping','mis')
           ), '[]'::jsonb);
    ELSE
      facts := COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'fy', e.financial_year,
                      'fact', CASE sv.code WHEN 'INT_AUDIT' THEN 'internal_audit' ELSE 'tax_audit' END))
               FROM hsdg.services sv
              WHERE sv.code IN ('INT_AUDIT','TAX_AUDIT')
                AND (sv.id = e.service_id
                     OR sv.id IN (SELECT es.service_id FROM hsdg.engagement_services es
                                   WHERE es.engagement_id = eng_id AND es.status <> 'cancelled'))
           ), '[]'::jsonb);
    END IF;
  END IF;
  PERFORM hsdg.put_independence_facts(e.id, e.entity_id, e.engagement_code, facts);
END;
$$;

CREATE FUNCTION hsdg.independence_facts_from_engagement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM hsdg.sync_independence_facts(NEW.id);
  RETURN NULL;
END;
$$;
CREATE FUNCTION hsdg.independence_facts_from_child() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM hsdg.sync_independence_facts(NEW.engagement_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER engagements_independence_facts
  AFTER INSERT OR UPDATE OF status, kind, financial_year, entity_id, service_id, engagement_code
  ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.independence_facts_from_engagement();
CREATE TRIGGER engagement_services_independence_facts
  AFTER INSERT OR UPDATE OF status, service_id ON hsdg.engagement_services
  FOR EACH ROW EXECUTE FUNCTION hsdg.independence_facts_from_child();
CREATE TRIGGER compliance_engagement_years_independence_facts
  AFTER INSERT OR UPDATE OF streams ON hsdg.compliance_engagement_years
  FOR EACH ROW EXECUTE FUNCTION hsdg.independence_facts_from_child();

-- The client's facts, for anyone who can see the client.
CREATE FUNCTION hsdg.entity_independence_facts(ent_id uuid)
RETURNS TABLE (engagement_id uuid, engagement_code text, financial_year text, fact text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  SELECT f.engagement_id, f.engagement_code, f.financial_year, f.fact
    FROM hsdg.engagement_independence_facts f
   WHERE f.entity_id = ent_id
     -- evaluated under the caller's policies: the client must be visible to them
     AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = ent_id)
   ORDER BY f.financial_year, f.fact
$$;
REVOKE ALL ON FUNCTION hsdg.entity_independence_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.entity_independence_facts(uuid) TO hsdg_app;

-- Backfill every existing engagement — the same facts sync_independence_facts
-- computes, set-based, with RLS lifted so the migrator sees all rows.
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.engagement_independence_facts
       (engagement_id, entity_id, engagement_code, financial_year, fact)
SELECT DISTINCT f.id, f.entity_id, f.engagement_code, f.fy, f.fact
  FROM (
    SELECT e.id, e.entity_id, e.engagement_code, e.financial_year AS fy, 'statutory_audit' AS fact
      FROM hsdg.engagements e WHERE e.kind = 'statutory_audit'
    UNION ALL
    SELECT e.id, e.entity_id, e.engagement_code, e.financial_year, 'compliance'
      FROM hsdg.engagements e WHERE e.kind = 'compliance'
    UNION ALL
    SELECT e.id, e.entity_id, e.engagement_code, y.financial_year, s
      FROM hsdg.engagements e
      JOIN hsdg.compliance_engagement_years y ON y.engagement_id = e.id
      CROSS JOIN LATERAL unnest(y.streams) AS s
     WHERE e.kind = 'compliance' AND s IN ('bookkeeping','mis')
    UNION ALL
    SELECT e.id, e.entity_id, e.engagement_code, e.financial_year,
           CASE sv.code WHEN 'INT_AUDIT' THEN 'internal_audit' ELSE 'tax_audit' END
      FROM hsdg.engagements e
      JOIN hsdg.services sv ON sv.code IN ('INT_AUDIT','TAX_AUDIT')
       AND (sv.id = e.service_id
            OR sv.id IN (SELECT es.service_id FROM hsdg.engagement_services es
                          WHERE es.engagement_id = e.id AND es.status <> 'cancelled'))
     WHERE e.kind = 'assignment'
  ) f
  JOIN hsdg.engagements e ON e.id = f.id
 WHERE e.status NOT IN ('closed','merged','cancelled','declined','withdrawn');
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP TRIGGER IF EXISTS compliance_engagement_years_independence_facts ON hsdg.compliance_engagement_years;
DROP TRIGGER IF EXISTS engagement_services_independence_facts ON hsdg.engagement_services;
DROP TRIGGER IF EXISTS engagements_independence_facts ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.entity_independence_facts(uuid);
DROP FUNCTION IF EXISTS hsdg.independence_facts_from_child();
DROP FUNCTION IF EXISTS hsdg.independence_facts_from_engagement();
DROP FUNCTION IF EXISTS hsdg.sync_independence_facts(uuid);
DROP FUNCTION IF EXISTS hsdg.put_independence_facts(uuid, uuid, text, jsonb);
DROP TABLE IF EXISTS hsdg.engagement_independence_facts;
