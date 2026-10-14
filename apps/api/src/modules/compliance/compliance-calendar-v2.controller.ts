import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type ComplianceCalendarResponse,
  type ComplianceEventRecord,
  type EntityComplianceProfiles,
  type GenerateCalendarResult,
  type RecordComplianceEventResult,
  type RocOverview,
  type SaveComplianceProfileResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { ComplianceCalendarV2Service } from './compliance-calendar-v2.service';
import {
  ComplianceCalendarV2QueryDto,
  CorrectComplianceEventDto,
  GenerateCalendarDto,
  RecordComplianceEventDto,
  SaveComplianceProfileDto,
  VerifyRuleDto,
  VoidComplianceEventDto,
} from './dto/calendar-v2.dto';

/** Calendar v2 ships behind ff_calendar_v2: off → the routes 404 like they don't exist. */
function requireCalendarV2(flags: FeatureFlagsService): void {
  if (!flags.isOn(FEATURE_FLAG.calendarV2)) throw new NotFoundException();
}

/** Per-engagement: generate the calendar, record events (spec Change 4). */
@ApiTags('engagement-compliance')
@Controller('engagements')
export class EngagementCalendarV2Controller {
  constructor(
    private readonly calendar: ComplianceCalendarV2Service,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Post(':id/compliance/generate-calendar')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate (or reconcile) the Compliance engagement’s filing calendar',
    description:
      'Idempotent: creates missing periods, moves not-started items whose dates changed, flags ' +
      'started ones ("Profile changed — check") and marks not-started items that no longer apply.',
  })
  generate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: GenerateCalendarDto,
  ): Promise<GenerateCalendarResult> {
    requireCalendarV2(this.flags);
    return this.calendar.generate(rlsContextFromPrincipal(principal), id, body.financialYear);
  }

  @Get(':id/compliance-events')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List the events recorded on the engagement (AGM, allotment, …)' })
  events(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ComplianceEventRecord[]> {
    requireCalendarV2(this.flags);
    return this.calendar.listEvents(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/compliance-events')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Record an event — creates the filings it triggers and moves AGM-linked dates',
  })
  recordEvent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RecordComplianceEventDto,
  ): Promise<RecordComplianceEventResult> {
    requireCalendarV2(this.flags);
    return this.calendar.recordEvent(rlsContextFromPrincipal(principal), id, body);
  }

  @Patch(':id/compliance-events/:eventId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Correct an event (date, year, details) — the filings it drives follow',
  })
  correctEvent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Body() body: CorrectComplianceEventDto,
  ): Promise<RecordComplianceEventResult> {
    requireCalendarV2(this.flags);
    return this.calendar.correctEvent(rlsContextFromPrincipal(principal), id, eventId, body);
  }

  @Delete(':id/compliance-events/:eventId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Void an event (with a reason) — not-started items it created no longer apply',
  })
  voidEvent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Body() body: VoidComplianceEventDto,
  ): Promise<RecordComplianceEventResult> {
    requireCalendarV2(this.flags);
    return this.calendar.voidEvent(rlsContextFromPrincipal(principal), id, eventId, body.reason);
  }

  @Get(':id/roc-overview')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The ROC tab header: CIN / LLPINs, why it is empty, next board meeting',
  })
  rocOverview(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RocOverview> {
    requireCalendarV2(this.flags);
    return this.calendar.rocOverview(rlsContextFromPrincipal(principal), id);
  }
}

/** Per-client compliance profiles (GSTIN / TAN / PAN / CIN / LLPIN). */
@ApiTags('entities')
@Controller('entities')
export class EntityComplianceProfilesController {
  constructor(
    private readonly calendar: ComplianceCalendarV2Service,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get(':entityId/compliance-profiles')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: 'The client’s registrations and their effective-dated compliance profiles',
  })
  profiles(
    @CurrentPrincipal() principal: Principal,
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
  ): Promise<EntityComplianceProfiles> {
    requireCalendarV2(this.flags);
    return this.calendar.getProfiles(rlsContextFromPrincipal(principal), entityId);
  }

  @Put(':entityId/compliance-profiles')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: 'Save a compliance profile from a date and regenerate the client’s calendars',
    description:
      'Same effective date → updates that row; a new date closes the row in force the day ' +
      'before. Write access: firm-wide, or a partner / manager on one of the client’s open ' +
      'engagements (checked in the database).',
  })
  saveProfile(
    @CurrentPrincipal() principal: Principal,
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
    @Body() body: SaveComplianceProfileDto,
  ): Promise<SaveComplianceProfileResult> {
    requireCalendarV2(this.flags);
    return this.calendar.saveProfile(rlsContextFromPrincipal(principal), entityId, body);
  }
}

/** The firm calendar (spec Change 4 "Calendar view") and its export. */
@ApiTags('compliance-calendar')
@Controller('compliance')
export class FirmCalendarV2Controller {
  constructor(
    private readonly calendar: ComplianceCalendarV2Service,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('calendar')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Every filing due across the caller’s Compliance engagements',
    description:
      'Default window: this month and the next 11. Unfiled items due earlier are included ' +
      '(overdue). Not-applicable items are left out unless asked for by status. Capped at 5,000.',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ComplianceCalendarV2QueryDto,
  ): Promise<ComplianceCalendarResponse> {
    requireCalendarV2(this.flags);
    return this.calendar.calendar(rlsContextFromPrincipal(principal), query);
  }

  // `calendar.xlsx` is the spec's path; `calendar/export` stays for existing callers.
  @Get(['calendar.xlsx', 'calendar/export'])
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The firm calendar as an Excel workbook (same filters)' })
  async export(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ComplianceCalendarV2QueryDto,
  ): Promise<StreamableFile> {
    requireCalendarV2(this.flags);
    const { buffer, filename } = await this.calendar.calendarWorkbook(
      rlsContextFromPrincipal(principal),
      query,
    );
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${filename}"`,
      length: buffer.length,
    });
  }
}

/** A partner confirms a rule marked "Verify" on the source sheet. */
@ApiTags('compliance-rules')
@Controller('compliance-rules')
export class ComplianceRuleVerifyController {
  constructor(private readonly calendar: ComplianceCalendarV2Service) {}

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.complianceManage)
  @ApiOperation({ summary: 'Confirm the rule version in force (clears the Verify badge)' })
  verify(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: VerifyRuleDto,
  ): Promise<{ versionId: string; verifiedAt: string }> {
    return this.calendar.verifyRule(rlsContextFromPrincipal(principal), id, body.note);
  }
}
