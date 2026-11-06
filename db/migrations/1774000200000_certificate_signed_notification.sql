-- Up Migration

-- Notification type certificate_signed: the partner signed a certificate (with
-- its UDIN); its preparer and reviewer hear of it, to issue it and bill it.
DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'certificate_signed'), 'certificate_signed');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type = 'certificate_signed';
DO $$
DECLARE
  types text[] := array_remove(hsdg.notification_types_now(), 'certificate_signed');
BEGIN
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;
