-- ─────────────────────────────────────────────────────────────────────────
-- PS-303 · the partner's monthly pack
--
-- On the 3rd of each month each partner's pack for last month is built as
-- that partner (so it is scoped as their screens are) and kept here: its
-- figures as they stood when built. The PDF is drawn from them on download.
-- A partner reads their own packs; the Managing Partner and administrators
-- read every one. Building a month again replaces it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.partner_packs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_employee_id  uuid NOT NULL REFERENCES hsdg.employees (id),
  month                text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  figures              jsonb NOT NULL,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  generated_by_user_id uuid,
  -- Set once the "pack ready" notice went out, so a rebuild does not repeat it.
  notified_at          timestamptz,
  UNIQUE (partner_employee_id, month)
);
CREATE INDEX partner_packs_month_idx ON hsdg.partner_packs (month DESC);

REVOKE ALL ON hsdg.partner_packs FROM hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.partner_packs TO hsdg_app;
ALTER TABLE hsdg.partner_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.partner_packs FORCE ROW LEVEL SECURITY;
CREATE POLICY partner_packs_select ON hsdg.partner_packs
  FOR SELECT USING (partner_employee_id = hsdg.ctx_employee_id() OR hsdg.ctx_is_business_firmwide());
-- Built as the partner it is for (the scheduler acts as each partner in turn).
CREATE POLICY partner_packs_insert ON hsdg.partner_packs
  FOR INSERT WITH CHECK (partner_employee_id = hsdg.ctx_employee_id());
CREATE POLICY partner_packs_update ON hsdg.partner_packs
  FOR UPDATE USING (partner_employee_id = hsdg.ctx_employee_id())
  WITH CHECK (partner_employee_id = hsdg.ctx_employee_id());

DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'partner_pack_ready'), 'partner_pack_ready');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type = 'partner_pack_ready';
DO $$
DECLARE
  types text[] := array_remove(hsdg.notification_types_now(), 'partner_pack_ready');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;
DROP TABLE IF EXISTS hsdg.partner_packs;
