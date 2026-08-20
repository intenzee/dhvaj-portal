import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/config.module';
import { NotificationsService } from './notifications.service';
import { NotificationsScanService } from './notifications-scan.service';
import { NotificationsController } from './notifications.controller';
import { EXTERNAL_CHANNELS, type NotificationChannel } from './channels/notification-channel';
import { EmailChannel } from './channels/email.channel';
import { TeamsChannel } from './channels/teams.channel';

/**
 * Notification framework (Phase 11). Emits typed events (portal + pluggable
 * external channels), scoped reads, and the date-driven sweep. Exports
 * {@link NotificationsService} so domain modules emit inside their own
 * transactions.
 *
 * The enabled external channels come from `NOTIFICATION_CHANNELS`; `portal`
 * (the persisted row) is always on and is not an external channel object.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsScanService,
    {
      provide: EXTERNAL_CHANNELS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): NotificationChannel[] => {
        const enabled = new Set(config.notificationChannels);
        const channels: NotificationChannel[] = [];
        if (enabled.has('email')) channels.push(new EmailChannel());
        if (enabled.has('teams')) channels.push(new TeamsChannel());
        return channels;
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
