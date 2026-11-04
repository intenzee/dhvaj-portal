-- ─────────────────────────────────────────────────────────────────────────
-- Merging two clients reaches the quick tasks and partner packs
--
-- merge_entities runs as the owner with the merge flag set, and every table
-- under row security gives the owner a "<table>_client_merge" policy so the
-- merge can move (or see past) its rows. A quick task names a client
-- (entity_id); its messages and the partner packs ride along with the rest.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE POLICY quick_tasks_client_merge ON hsdg.quick_tasks
  FOR ALL TO hsdg_migrator
  USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());
CREATE POLICY quick_task_messages_client_merge ON hsdg.quick_task_messages
  FOR ALL TO hsdg_migrator
  USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());
CREATE POLICY partner_packs_client_merge ON hsdg.partner_packs
  FOR ALL TO hsdg_migrator
  USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());

-- Down Migration

DROP POLICY IF EXISTS partner_packs_client_merge ON hsdg.partner_packs;
DROP POLICY IF EXISTS quick_task_messages_client_merge ON hsdg.quick_task_messages;
DROP POLICY IF EXISTS quick_tasks_client_merge ON hsdg.quick_tasks;
