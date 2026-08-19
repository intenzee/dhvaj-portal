import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { ComplianceRulesService } from './compliance-rules.service';
import type { ComplianceRuleRecord } from './compliance.types';
import {
  AddHolidayDto,
  AddRuleVersionDto,
  ComplianceRuleListQueryDto,
  CreateComplianceRuleDto,
  SetRuleActiveDto,
} from './dto/rule.dto';

/**
 * Firm-wide compliance CONFIG (Phase 8): rules, their effective-dated versions,
 * and the holiday calendar. Reads need `compliance.read` (all staff); writes need
 * `compliance.manage` and are additionally floored by `ctx_is_firmwide` RLS.
 */
@ApiTags('compliance-config')
@Controller('compliance-rules')
export class ComplianceRulesController {
  constructor(private readonly rules: ComplianceRulesService) {}

  @Get()
  @RequirePermissions(PERMISSION.complianceRead)
  @ApiOperation({ summary: 'List compliance rules with their version history (paginated)' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ComplianceRuleListQueryDto,
  ): Promise<Paginated<ComplianceRuleRecord>> {
    const filter: { category?: string; serviceCode?: string; activeOnly?: boolean } = {};
    if (query.category) filter.category = query.category;
    if (query.serviceCode) filter.serviceCode = query.serviceCode;
    if (query.activeOnly !== undefined) filter.activeOnly = query.activeOnly;
    return this.rules
      .listRules(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }

  @Get(':idOrCode')
  @RequirePermissions(PERMISSION.complianceRead)
  @ApiOperation({ summary: 'Get one compliance rule (by id or code) with all versions' })
  getOne(
    @CurrentPrincipal() principal: Principal,
    @Param('idOrCode') idOrCode: string,
  ): Promise<ComplianceRuleRecord> {
    return this.rules.getRule(rlsContextFromPrincipal(principal), idOrCode);
  }

  @Post()
  @RequirePermissions(PERMISSION.complianceManage)
  @ApiOperation({ summary: 'Create a compliance rule (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateComplianceRuleDto,
  ): Promise<ComplianceRuleRecord> {
    return this.rules.createRule(rlsContextFromPrincipal(principal), dto);
  }

  @Post(':id/versions')
  @RequirePermissions(PERMISSION.complianceManage)
  @ApiOperation({
    summary: 'Add an effective-dated rule version (append-only; audited)',
    description:
      'Adding a version is how a rule is "changed" — existing compliance instances keep the ' +
      'version they snapshotted, so history is never rewritten.',
  })
  addVersion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddRuleVersionDto,
  ): Promise<ComplianceRuleRecord> {
    return this.rules.addRuleVersion(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/active')
  @RequirePermissions(PERMISSION.complianceManage)
  @ApiOperation({ summary: 'Activate or deactivate a compliance rule (audited)' })
  setActive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetRuleActiveDto,
  ): Promise<ComplianceRuleRecord> {
    return this.rules.setRuleActive(rlsContextFromPrincipal(principal), id, dto.isActive);
  }
}

@ApiTags('compliance-config')
@Controller('compliance-holidays')
export class ComplianceHolidaysController {
  constructor(private readonly rules: ComplianceRulesService) {}

  @Get()
  @RequirePermissions(PERMISSION.complianceRead)
  @ApiOperation({ summary: 'List the working-day holiday calendar' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.rules.listHolidays(rlsContextFromPrincipal(principal));
  }

  @Post()
  @RequirePermissions(PERMISSION.complianceManage)
  @ApiOperation({ summary: 'Add a holiday to the working-day calendar (audited)' })
  add(@CurrentPrincipal() principal: Principal, @Body() dto: AddHolidayDto) {
    return this.rules.addHoliday(rlsContextFromPrincipal(principal), dto.date, dto.name);
  }
}
