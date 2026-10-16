import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type AppealNoticeResponse,
  type Notice,
  type NoticeListResponse,
  type NoticeType,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { NoticesService } from './notices.service';
import { NoticeTypesService } from './notice-types.service';
import {
  AddNoticeEventDto,
  AppealNoticeDto,
  CloseNoticeDto,
  CreateNoticeDto,
  NoticeDocumentUploadDto,
  NoticeListQueryDto,
  UpdateNoticeDto,
  UpsertNoticeTypeDto,
  VoidNoticeEventDto,
} from './dto/notices.dto';

const canManage = (p: Principal) => p.permissions.includes(PERMISSION.noticeManage);

function requireNotices(flags: FeatureFlagsService, principal: Principal): void {
  if (!flags.isOnFor(FEATURE_FLAG.notices, principal.officeCode)) throw new NotFoundException();
}

/**
 * Practice Services PS-101 — the notice register. Behind ff_notices (404 when
 * off for the caller's office). Reads need engagement.read and are scoped by
 * RLS to the engagement team (404 for anyone else); writes need notice.manage
 * and a place on the team, and carry the version read (409 when stale).
 */
@ApiTags('notices')
@Controller('notices')
export class NoticesController {
  constructor(
    private readonly notices: NoticesService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Notices the caller can see, by the clock date' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: NoticeListQueryDto,
  ): Promise<NoticeListResponse> {
    requireNotices(this.flags, principal);
    return this.notices.list(rlsContextFromPrincipal(principal), query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'A notice with its events and papers' })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Notice> {
    requireNotices(this.flags, principal);
    return this.notices.get(rlsContextFromPrincipal(principal), id, {
      canManage: canManage(principal),
    });
  }

  @Post()
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({ summary: 'Record a notice on an engagement' })
  create(@CurrentPrincipal() principal: Principal, @Body() body: CreateNoticeDto): Promise<Notice> {
    requireNotices(this.flags, principal);
    return this.notices.create(rlsContextFromPrincipal(principal), body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({ summary: 'Change a notice (versioned)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateNoticeDto,
  ): Promise<Notice> {
    requireNotices(this.flags, principal);
    return this.notices.update(rlsContextFromPrincipal(principal), id, body);
  }

  @Post(':id/events')
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({ summary: 'Record what happened on a notice (reply, hearing, order …)' })
  addEvent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddNoticeEventDto,
  ): Promise<Notice> {
    requireNotices(this.flags, principal);
    return this.notices.addEvent(rlsContextFromPrincipal(principal), id, body);
  }

  @Post(':id/events/:eventId/void')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({ summary: 'Void a mistaken event; the status follows the rest' })
  voidEvent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() body: VoidNoticeEventDto,
  ): Promise<Notice> {
    requireNotices(this.flags, principal);
    return this.notices.voidEvent(rlsContextFromPrincipal(principal), id, eventId, body);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({ summary: 'Close a notice with its outcome' })
  close(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CloseNoticeDto,
  ): Promise<Notice> {
    requireNotices(this.flags, principal);
    return this.notices.close(rlsContextFromPrincipal(principal), id, body);
  }

  @Post(':id/appeal')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({ summary: 'Appeal the order: open its Assignment engagement (PS-103)' })
  appeal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AppealNoticeDto,
  ): Promise<AppealNoticeResponse> {
    requireNotices(this.flags, principal);
    return this.notices.appealNotice(rlsContextFromPrincipal(principal), id, body);
  }

  @Post(':id/documents')
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({ summary: 'Upload the notice, the reply or the order under the notice' })
  upload(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NoticeDocumentUploadDto,
  ): Promise<Notice> {
    requireNotices(this.flags, principal);
    return this.notices.upload(rlsContextFromPrincipal(principal), id, body);
  }
}

/** PS-101 — the notice-type library: any staff reads; workflow.manage maintains. */
@ApiTags('notices')
@Controller('notice-types')
export class NoticeTypesController {
  constructor(
    private readonly types: NoticeTypesService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The notice-type library' })
  list(@CurrentPrincipal() principal: Principal): Promise<NoticeType[]> {
    requireNotices(this.flags, principal);
    return this.types.list(rlsContextFromPrincipal(principal));
  }

  @Put(':code')
  @RequirePermissions(PERMISSION.workflowManage)
  @ApiOperation({ summary: 'Add or change a notice type (versioned)' })
  upsert(
    @CurrentPrincipal() principal: Principal,
    @Param('code') code: string,
    @Body() body: UpsertNoticeTypeDto,
  ): Promise<NoticeType> {
    requireNotices(this.flags, principal);
    if (!/^[A-Z0-9_]{2,40}$/.test(code))
      throw new BadRequestException('A notice type code is 2–40 capitals, digits or underscores.');
    return this.types.upsert(rlsContextFromPrincipal(principal), code, body);
  }
}
