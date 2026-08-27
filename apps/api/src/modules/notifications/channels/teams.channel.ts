import { Logger } from '@nestjs/common';
import type { NotificationChannel, OutboundNotification } from './notification-channel';

/**
 * Microsoft Teams delivery channel.
 *
 * Placeholder implementation for the foundation: it logs the intent rather than
 * posting to Teams, so the channel abstraction is exercised without a Graph/
 * webhook dependency. A real transport (Teams incoming webhook or Graph
 * chatMessage) drops in here behind the same interface.
 */
export class TeamsChannel implements NotificationChannel {
  readonly name = 'teams';
  private readonly logger = new Logger(TeamsChannel.name);

  async deliver(notification: OutboundNotification): Promise<void> {
    const to = notification.recipientEmail
      ? `client <${notification.recipientEmail}>`
      : `user ${notification.recipientUserId}`;
    this.logger.debug(`[teams] → ${to}: ${notification.type} — ${notification.title}`);
  }
}
