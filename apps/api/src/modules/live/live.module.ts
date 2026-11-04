import { Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveEventsService } from './live-events.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Live events to the signed-in person (Server-Sent Events over pg NOTIFY),
 * and Web Push to their devices when the portal is not open.
 */
@Module({
  controllers: [LiveController, PushController],
  providers: [LiveEventsService, PushService],
  exports: [LiveEventsService, PushService],
})
export class LiveModule {}
