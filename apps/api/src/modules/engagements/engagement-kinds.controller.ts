import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type ComplianceEngagementYear,
  type IndependenceCheckResult,
  type StreamCatalogueEntry,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { FyParamPipe } from './fy-param.pipe';
import { EngagementKindsService } from './engagement-kinds.service';
import {
  AddComplianceYearDto,
  IndependenceCheckDto,
  UpdateComplianceYearDto,
  UpdateYearStreamsDto,
} from './dto/engagement-kinds.dto';

/** Engagement kinds ship behind ff_engagement_kinds: off → the routes 404. */
export function requireEngagementKinds(flags: FeatureFlagsService): void {
  if (!flags.isOn(FEATURE_FLAG.engagementKinds)) throw new NotFoundException();
}

/**
 * Spec Change 1: the independence pre-check the wizard runs, and the standing
 * Compliance engagement's years in scope and their streams.
 */
@ApiTags('engagements')
@Controller('engagements')
export class EngagementKindsController {
  constructor(
    private readonly kinds: EngagementKindsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Post('independence-check')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Preview the independence rules for a proposed engagement, year or stream',
    description:
      'Section 144 (company auditor: no bookkeeping, MIS or internal audit; filing streams need ' +
      'approval), section 44AB (no tax audit by the bookkeeper) and the non-company audit ' +
      'acknowledgement. Also reports the client’s open Compliance engagement, if any.',
  })
  checkIndependence(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: IndependenceCheckDto,
  ): Promise<IndependenceCheckResult> {
    requireEngagementKinds(this.flags);
    return this.kinds.checkIndependence(rlsContextFromPrincipal(principal), dto);
  }

  @Get(':id/years')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Years in scope on a Compliance engagement' })
  listYears(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ComplianceEngagementYear[]> {
    requireEngagementKinds(this.flags);
    return this.kinds.listYears(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/years')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Add a year in scope (defaults to the latest year’s streams; generates its calendar)',
  })
  addYear(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddComplianceYearDto,
  ): Promise<ComplianceEngagementYear> {
    requireEngagementKinds(this.flags);
    return this.kinds.addYear(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/years/:fy')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a year’s fee, budget, letter or approval; close or reopen it' })
  updateYear(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fy', FyParamPipe) fy: string,
    @Body() dto: UpdateComplianceYearDto,
  ): Promise<ComplianceEngagementYear> {
    requireEngagementKinds(this.flags);
    return this.kinds.updateYear(rlsContextFromPrincipal(principal), id, fy, dto);
  }

  @Patch(':id/years/:fy/streams')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Add or end streams for a year (independence rules apply to added ones)',
  })
  updateYearStreams(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fy', FyParamPipe) fy: string,
    @Body() dto: UpdateYearStreamsDto,
  ): Promise<ComplianceEngagementYear> {
    requireEngagementKinds(this.flags);
    return this.kinds.updateYearStreams(rlsContextFromPrincipal(principal), id, fy, dto);
  }
}

@ApiTags('engagements')
@Controller('streams')
export class StreamsController {
  constructor(
    private readonly kinds: EngagementKindsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The six compliance streams and the service each one carries' })
  list(@CurrentPrincipal() principal: Principal): Promise<StreamCatalogueEntry[]> {
    requireEngagementKinds(this.flags);
    return this.kinds.listStreams(rlsContextFromPrincipal(principal));
  }
}
