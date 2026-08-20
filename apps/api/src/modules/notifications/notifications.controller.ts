import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { NotificationsService } from './notifications.service';
import { NotificationsScanService, type ScanResult } from './notifications-scan.service';
import type { NotificationRecord } from './notifications.types';
import { NotificationListQueryDto } from './dto/notification.dto';

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
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'List my notifications (paginated); filter ?status=&unreadOnly=' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationRecord>> {
    const filter: { status?: NotificationListQueryDto['status']; unreadOnly?: boolean } = {};
    if (query.status) filter.status = query.status;
    if (query.unreadOnly) filter.unreadOnly = query.unreadOnly;
    return this.notifications
      .list(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }

  @Get('unread-count')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Count my unread notifications (badge)' })
  unreadCount(@CurrentPrincipal() principal: Principal): Promise<{ unread: number }> {
    return this.notifications.unreadCount(rlsContextFromPrincipal(principal));
  }

  @Post('read-all')
  @RequirePermissions(PERMISSION.notificationRead)
  @ApiOperation({ summary: 'Mark all my unread notifications read' })
  markAllRead(@CurrentPrincipal() principal: Principal): Promise<{ updated: number }> {
    return this.notifications.markAllRead(rlsContextFromPrincipal(principal));
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
