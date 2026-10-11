import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AnalyticsLibrary,
  type AnalyticsMetricRecord,
  type AnalyticsProfileRecord,
  type AnalyticsRuleRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  CreateAnalyticsMetricVersionDto,
  CreateAnalyticsProfileVersionDto,
  CreateAnalyticsRuleVersionDto,
} from './dto/analytics-library.dto';
import { PlanningAnalyticsLibraryService } from './planning-analytics-library';

/**
 * Analytics Methodology Library administration (DHVAJ 03.2 §12, §15, §17, §23):
 * canonical metrics, industry profiles and analytics rules. Insert-only —
 * every change appends a version. Methodology only: no client data and no
 * conclusion authority.
 */
@ApiTags('planning-analytics-library')
@Controller('planning-analytics-library')
export class PlanningAnalyticsLibraryController {
  constructor(private readonly library: PlanningAnalyticsLibraryService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Every metric, profile and rule version in the analytics library' })
  list(@CurrentPrincipal() principal: Principal): Promise<AnalyticsLibrary> {
    return this.library.list(rlsContextFromPrincipal(principal));
  }

  @Post('metrics')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append a canonical metric version (or a new metric)' })
  addMetric(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateAnalyticsMetricVersionDto,
  ): Promise<AnalyticsMetricRecord> {
    return this.library.addMetricVersion(rlsContextFromPrincipal(principal), dto);
  }

  @Post('profiles')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append an industry profile version (or a new profile)' })
  addProfile(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateAnalyticsProfileVersionDto,
  ): Promise<AnalyticsProfileRecord> {
    return this.library.addProfileVersion(rlsContextFromPrincipal(principal), dto);
  }

  @Post('rules')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append an analytics rule version (or a new rule)' })
  addRule(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateAnalyticsRuleVersionDto,
  ): Promise<AnalyticsRuleRecord> {
    return this.library.addRuleVersion(rlsContextFromPrincipal(principal), dto);
  }
}
