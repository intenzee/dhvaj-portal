import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type NotificationDigest,
  type NotificationPreference,
  type Paginated,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { istToday } from '../engagements/time/auto-time';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { NotificationsService } from './notifications.service';
import { NotificationsScanService, type ScanResult } from './notifications-scan.service';
import type { NotificationRecord } from './notifications.types';
import {
  NotificationDigestQueryDto,
  NotificationListQueryDto,
  NotificationPreferencesDto,
} from './dto/notification.dto';

/**
 * Notifications (Phase 11). Every endpoint is recipient-scoped by RLS — a user
 * sees and mutates only their own inbox (`notification.read`). The sweep that
 * generates date-driven notifications is operator/worker-only
 * (`notification.scan`).
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly scan: NotificationsScanService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** WF-305 (behind ff_filing_runs): the bell carries only what reaches it. */
  private actionable(principal: Principal): boolean {
    return this.flags.isOnFor(FEATURE_FLAG.filingRuns, principal.officeCode);
  }

  private requireActionable(principal: Principal): void {
    if (!this.actionable(principal)) throw new NotFoundException();
  }

  @Get()
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'List my notifications (paginated); filter ?status=&unreadOnly=' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationRecord>> {
    const filter: {
      status?: NotificationListQueryDto['status'];
      unreadOnly?: boolean;
      type?: NotificationListQueryDto['type'];
      bellOnly?: boolean;
    } = {};
    if (this.actionable(principal) && query.scope !== 'all') filter.bellOnly = true;
    if (query.status) filter.status = query.status;
    if (query.unreadOnly) filter.unreadOnly = query.unreadOnly;
    if (query.type) filter.type = query.type;
    return this.notifications
      .list(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }

  @Get('unread-count')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Count my unread notifications (badge)' })
  unreadCount(@CurrentPrincipal() principal: Principal): Promise<{ unread: number }> {
    return this.notifications.unreadCount(
      rlsContextFromPrincipal(principal),
      this.actionable(principal),
    );
  }

  @Get('digest')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: "A day's informational notices, by type (WF-305 daily digest)" })
  digest(
    @CurrentPrincipal() principal: Principal,
    @Query() query: NotificationDigestQueryDto,
  ): Promise<NotificationDigest> {
    this.requireActionable(principal);
    return this.notifications.digest(rlsContextFromPrincipal(principal), query.date ?? istToday());
  }

  @Get('preferences')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Where each notification type reaches me (bell, digest, off)' })
  preferences(@CurrentPrincipal() principal: Principal): Promise<NotificationPreference[]> {
    this.requireActionable(principal);
    return this.notifications.preferences(rlsContextFromPrincipal(principal));
  }

  @Put('preferences')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Move informational types between the bell, the digest and off' })
  setPreferences(
    @CurrentPrincipal() principal: Principal,
    @Body() body: NotificationPreferencesDto,
  ): Promise<NotificationPreference[]> {
    this.requireActionable(principal);
    return this.notifications.setPreferences(rlsContextFromPrincipal(principal), body.items);
  }

  @Post('digest/send')
  @RequirePermissions(PERMISSION.notificationScan)
  @ApiOperation({
    summary: "Queue the day's digest e-mail to everyone with notices in it (operator; once a day)",
  })
  sendDigest(
    @CurrentPrincipal() principal: Principal,
    @Query() query: NotificationDigestQueryDto,
  ): Promise<{ users: number }> {
    return this.notifications.sendDigests(
      rlsContextFromPrincipal(principal),
      query.date ?? istToday(),
    );
  }

  @Post('read-all')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Mark all my unread notifications read' })
  markAllRead(@CurrentPrincipal() principal: Principal): Promise<{ updated: number }> {
    return this.notifications.markAllRead(
      rlsContextFromPrincipal(principal),
      this.actionable(principal),
    );
  }

  @Post('scan')
  @RequirePermissions(PERMISSION.notificationScan)
  @ApiOperation({
    summary: 'Run the date-driven notification sweep (operator/worker; idempotent)',
    description:
      'Emits internal-SLA overdue/approaching, statutory-deadline approaching, and client-' +
      'dependency reminders for everything the caller can see. Safe to run repeatedly.',
  })
  runScan(@CurrentPrincipal() principal: Principal): Promise<ScanResult> {
    return this.scan.run(rlsContextFromPrincipal(principal));
  }

  @Post(':id/read')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<NotificationRecord> {
    return this.notifications.markRead(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/dismiss')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Dismiss one notification' })
  dismiss(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<NotificationRecord> {
    return this.notifications.dismiss(rlsContextFromPrincipal(principal), id);
  }
}
