-- ─────────────────────────────────────────────────────────────────────────
-- Change log: every add, edit and removal on a client or an engagement
--
-- The audit trail records what each service chose to record. The change log
-- is kept by the database itself: a row added, changed or removed in a
-- client's master (registrations, contacts, addresses, offices, portal logins,
-- financials, …) or an engagement's (team, services, years, fees, …) writes
-- one entry — who, when, and each field's old and new value — whichever
-- screen, import or job made it. Only the Managing Partner and an
-- administrator read it (ctx_is_firmwide); nobody edits or deletes it. Portal
-- passwords are never copied in (the vault columns are left out).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.change_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role    text,
  table_name    text NOT NULL,
  row_id        text,
  op            text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  -- No foreign keys: the log outlives the client or engagement it is about.
  entity_id     uuid,
  engagement_id uuid,
  label         text,
  changes       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX change_log_occurred_idx ON hsdg.change_log (occurred_at DESC, id DESC);
CREATE INDEX change_log_entity_idx ON hsdg.change_log (entity_id, occurred_at DESC);
CREATE INDEX change_log_engagement_idx ON hsdg.change_log (engagement_id, occurred_at DESC);
CREATE INDEX change_log_actor_idx ON hsdg.change_log (actor_user_id, occurred_at DESC);

REVOKE ALL ON hsdg.change_log FROM hsdg_app;
GRANT SELECT, INSERT ON hsdg.change_log TO hsdg_app;
GRANT USAGE ON SEQUENCE hsdg.change_log_id_seq TO hsdg_app;
ALTER TABLE hsdg.change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.change_log FORCE ROW LEVEL SECURITY;
CREATE POLICY change_log_select ON hsdg.change_log
  FOR SELECT USING (hsdg.ctx_is_firmwide());
-- The app writes only as the user it acts for (the trigger below).
CREATE POLICY change_log_insert ON hsdg.change_log
  FOR INSERT TO hsdg_app
  WITH CHECK (actor_user_id IS NOT DISTINCT FROM hsdg.ctx_user_id());
-- The owner's SECURITY DEFINER functions change rows too.
CREATE POLICY change_log_owner_insert ON hsdg.change_log
  FOR INSERT TO hsdg_migrator WITH CHECK (true);

/**
 * AFTER row trigger: one change_log entry per insert / update / delete. An
 * update that changes only bookkeeping (version, updated_at) is not logged.
 * TG_ARGV: further columns to leave out.
 */
CREATE FUNCTION hsdg.log_change() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE
  o    jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n    jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r    jsonb := COALESCE(n, o);
  skip text[] := ARRAY['version', 'created_at', 'updated_at', 'ciphertext', 'iv', 'auth_tag',
                       'key_version', 'created_by_user_id', 'updated_by_user_id']
                 || TG_ARGV::text[];
  diff jsonb := '{}'::jsonb;
  k    text;
  ent  uuid;
  eng  uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      CONTINUE WHEN k = ANY (skip);
      IF (o -> k) IS DISTINCT FROM (n -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO diff
      FROM jsonb_each(r)
     WHERE key <> ALL (skip) AND value <> 'null'::jsonb AND key <> 'id';
  END IF;

  eng := CASE WHEN TG_TABLE_NAME = 'engagements' THEN (r ->> 'id')::uuid
              ELSE (r ->> 'engagement_id')::uuid END;
  ent := CASE WHEN TG_TABLE_NAME = 'entities' THEN (r ->> 'id')::uuid
              ELSE COALESCE((r ->> 'entity_id')::uuid, (r ->> 'from_entity_id')::uuid) END;
  IF ent IS NULL AND eng IS NOT NULL THEN
    SELECT e.entity_id INTO ent FROM hsdg.engagements e WHERE e.id = eng;
  END IF;

  INSERT INTO hsdg.change_log
    (actor_user_id, actor_role, table_name, row_id, op, entity_id, engagement_id, label, changes)
  VALUES (
    hsdg.ctx_user_id(), hsdg.ctx_role(), TG_TABLE_NAME,
    COALESCE(r ->> 'id', r ->> 'engagement_id'), lower(TG_OP), ent, eng,
    COALESCE(r ->> 'registration_number', r ->> 'legal_name', r ->> 'engagement_code',
             r ->> 'full_name', r ->> 'label',
             CASE WHEN TG_TABLE_NAME = 'client_credentials'
                  THEN concat_ws(' · ', r ->> 'portal', r ->> 'account', r ->> 'username_hint') END,
             r ->> 'description', r ->> 'financial_year', r ->> 'role_on_engagement',
             r ->> 'attribute_code', r ->> 'line1', r ->> 'exchange'),
    diff);
  RETURN NULL;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entities', 'entity_registrations', 'entity_contacts', 'entity_addresses', 'entity_branches',
    'entity_business_activities', 'entity_financial_profiles', 'entity_listings',
    'entity_relationships', 'entity_regulatory_attributes', 'registration_compliance_profiles',
    'client_credentials',
    'engagements', 'compliance_engagement_years', 'engagement_services', 'engagement_team',
    'engagement_commercial', 'engagement_fee_milestones', 'engagement_entities',
    'engagement_offices'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON hsdg.%I
         FOR EACH ROW EXECUTE FUNCTION hsdg.log_change()',
      t || '_change_log', t);
  END LOOP;
END $$;

-- Down Migration

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entities', 'entity_registrations', 'entity_contacts', 'entity_addresses', 'entity_branches',
    'entity_business_activities', 'entity_financial_profiles', 'entity_listings',
    'entity_relationships', 'entity_regulatory_attributes', 'registration_compliance_profiles',
    'client_credentials',
    'engagements', 'compliance_engagement_years', 'engagement_services', 'engagement_team',
    'engagement_commercial', 'engagement_fee_milestones', 'engagement_entities',
    'engagement_offices'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON hsdg.%I', t || '_change_log', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS hsdg.log_change();
DROP TABLE IF EXISTS hsdg.change_log;
