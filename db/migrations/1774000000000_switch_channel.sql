-- Up Migration

-- Switch team chat as a notification channel: the portal posts each event once
-- into the Switch room its type belongs to (see SwitchChannel).
ALTER TABLE hsdg.notification_deliveries
  DROP CONSTRAINT notification_deliveries_channel_check;
ALTER TABLE hsdg.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('email', 'teams', 'switch'));

-- Down Migration

DELETE FROM hsdg.notification_deliveries WHERE channel = 'switch';
ALTER TABLE hsdg.notification_deliveries
  DROP CONSTRAINT notification_deliveries_channel_check;
ALTER TABLE hsdg.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('email', 'teams'));
