import { Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveEventsService } from './live-events.service';

/** Live events to the signed-in person (Server-Sent Events over pg NOTIFY). */
@Module({
  controllers: [LiveController],
  providers: [LiveEventsService],
  exports: [LiveEventsService],
})
export class LiveModule {}
