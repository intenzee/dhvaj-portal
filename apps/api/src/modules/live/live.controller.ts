import { Controller, ForbiddenException, Header, type MessageEvent, Sse } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { interval, map, merge, type Observable } from 'rxjs';
import { LIVE_PING_MS } from '@hsdg/contracts';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';
import { LiveEventsService } from './live-events.service';

@ApiTags('live')
@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveEventsService) {}

  /**
   * Server-Sent Events for the signed-in person: `event: quick_task.assigned`
   * / `quick_task.reply` as they happen, and `event: ping` every 25 s. The
   * web reads it with fetch (so the bearer token stays in a header).
   */
  @Sse('stream')
  @SkipThrottle()
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({ summary: 'Live events for the signed-in person (Server-Sent Events)' })
  stream(@CurrentPrincipal() principal: Principal): Observable<MessageEvent> {
    if (!principal.employeeId) throw new ForbiddenException(notLinkedToEmployee('get live alerts'));
    return merge(
      this.live
        .subscribe(principal.employeeId)
        .pipe(map((e): MessageEvent => ({ type: e.kind, id: e.id, data: e }))),
      interval(LIVE_PING_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: {} }))),
    );
  }
}
