-- ─────────────────────────────────────────────────────────────────────────
-- Chat and attendance tables: the owner's merge / erase policies
--
-- WHY: every hsdg table under row security gives the owner (hsdg_migrator)
-- the "<table>_client_merge" policy its SECURITY DEFINER jobs run under
-- (client merge, erasing a person). The chat and attendance tables were
-- added without them, so those jobs would see none of their rows; the
-- client-merge e2e guard ("every table under row security …") caught it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_settings', 'chat_conversations', 'chat_messages',
                           'chat_presence', 'firm_holidays'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON hsdg.%I FOR ALL TO hsdg_migrator
         USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients())',
      t || '_client_merge', t);
    EXECUTE format(
      'CREATE POLICY erase_person ON hsdg.%I FOR ALL TO hsdg_migrator
         USING (current_setting(''hsdg.erasing_person'', true) = ''on'')
         WITH CHECK (current_setting(''hsdg.erasing_person'', true) = ''on'')', t);
  END LOOP;
END $$;

-- Down Migration

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_settings', 'chat_conversations', 'chat_messages',
                           'chat_presence', 'firm_holidays'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON hsdg.%I', t || '_client_merge', t);
    EXECUTE format('DROP POLICY IF EXISTS erase_person ON hsdg.%I', t);
  END LOOP;
END $$;
