-- ─────────────────────────────────────────────────────────────────────────
-- Notification type team_changed
--
-- The person added to or taken off an engagement's team, and the incoming and
-- outgoing Manager, hear about it. The engagement's Partner and Manager now
-- change its team themselves (RLS already let its leads write the team; the
-- API used to ask for engagement.assign), so the change needs telling.
--
-- The type list is rebuilt from whatever it holds now (other tracks add types
-- in parallel), plus ours. PostgreSQL prints the list as ARRAY['a'::text, …]
-- after a `type IN (…)` and as '{a,…}'::text[] after a rebuilt one, so the
-- names are read from either.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE FUNCTION hsdg.notification_types_now() RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT array_remove(regexp_split_to_array(
           regexp_replace(
             replace(replace(substring(pg_get_constraintdef(c.oid) FROM 'ANY \((.*)$'),
                             '::text', ''), 'ARRAY', ''),
             '[^a-z_,]', '', 'g'),
           ','), '')
    FROM pg_constraint c
   WHERE c.conrelid = 'hsdg.notifications'::regclass AND c.conname = 'notifications_type_check'
$$;

DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'team_changed'), 'team_changed');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type = 'team_changed';
DO $$
DECLARE
  types text[] := array_remove(hsdg.notification_types_now(), 'team_changed');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;
DROP FUNCTION hsdg.notification_types_now();
