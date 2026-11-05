import {
  Controller,
  ForbiddenException,
  Header,
  Logger,
  type MessageEvent,
  Sse,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { finalize, interval, map, merge, tap, type Observable } from 'rxjs';
import { CHAT_ONLINE_WINDOW_MS, LIVE_PING_MS } from '@hsdg/contracts';
import { CurrentPrincipal } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';
import { DatabaseService } from '../../database/database.service';
import { LiveEventsService } from './live-events.service';

@ApiTags('live')
@Controller('live')
export class LiveController {
  private readonly logger = new Logger(LiveController.name);

  constructor(
    private readonly live: LiveEventsService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Server-Sent Events for the signed-in person: `event: quick_task.assigned`
   * / `quick_task.reply` and `chat.message` / `chat.receipt` / `chat.typing`
   * as they happen, and `event: ping` every 25 s. The web reads it with fetch
   * (so the bearer token stays in a header). While it is open the person is
   * "online" in chat: it is marked seen on open, on each ping and on close.
   */
  @Sse('stream')
  @SkipThrottle()
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({ summary: 'Live events for the signed-in person (Server-Sent Events)' })
  stream(@CurrentPrincipal() principal: Principal): Observable<MessageEvent> {
    if (!principal.employeeId) throw new ForbiddenException(notLinkedToEmployee('get live alerts'));
    const seen = (): void => this.touch(principal, true);
    seen();
    return merge(
      this.live
        .subscribe(principal.employeeId)
        .pipe(map((e): MessageEvent => ({ type: e.kind, id: e.id, data: e }))),
      interval(LIVE_PING_MS).pipe(
        tap(seen),
        map((): MessageEvent => ({ type: 'ping', data: {} })),
      ),
    ).pipe(finalize(() => this.touch(principal, false)));
  }

  /**
   * Chat presence: seen now, and online for the next minute (a ping comes
   * every 25 s) — or, as the stream closes, online no longer. Best effort.
   */
  private touch(principal: Principal, open: boolean): void {
    const me = principal.employeeId;
    if (!me) return;
    void this.db
      .withRlsContext(rlsContextFromPrincipal(principal), (client) =>
        client.query(
          `INSERT INTO hsdg.chat_presence AS p (employee_id, last_seen_at, online_until)
           VALUES ($1, now(), now() + $2 * interval '1 millisecond')
           ON CONFLICT (employee_id) DO UPDATE
             SET last_seen_at = now(), online_until = EXCLUDED.online_until`,
          [me, open ? CHAT_ONLINE_WINDOW_MS : 0],
        ),
      )
      .catch((err: Error) => this.logger.warn(`Could not mark ${me} seen: ${err.message}`));
  }
}
