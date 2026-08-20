import { Logger } from '@nestjs/common';
import type { NotificationChannel, OutboundNotification } from './notification-channel';

/**
 * Email delivery channel.
 *
 * Placeholder implementation for the foundation: it logs the intent rather than
 * sending mail, so the channel abstraction is exercised end-to-end without an
 * SMTP/Graph dependency. A real transport (e.g. Microsoft Graph sendMail or
 * Azure Communication Services) drops in here behind the same interface, and
 * should move to a post-commit outbox worker for at-least-once delivery.
 */
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private readonly logger = new Logger(EmailChannel.name);

  async deliver(notification: OutboundNotification): Promise<void> {
    this.logger.debug(
      `[email] → user ${notification.recipientUserId}: ${notification.type} — ${notification.title}`,
    );
  }
}
