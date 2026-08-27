import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { GovernmentExtensionsService } from './government-extensions.service';
import type { GovernmentExtensionRecord } from './compliance.types';
import { CreateGovernmentExtensionDto, GovernmentExtensionListQueryDto } from './dto/extension.dto';

/**
 * Government extensions (§19) — firm-wide statutory CONFIG. Reads need
 * `compliance.read` (all staff, like the rule/holiday calendar); writes need
 * `compliance.manage` and are additionally floored by `ctx_is_firmwide` RLS.
 * Applying an extension to an engagement obligation lives on the engagement-
 * scoped compliance controller instead.
 */
@ApiTags('compliance-config')
@Controller('compliance-extensions')
export class GovernmentExtensionsController {
  constructor(private readonly extensions: GovernmentExtensionsService) {}

  @Get()
  @RequirePermissions(PERMISSION.complianceRead)
  @ApiOperation({ summary: 'List government extensions (paginated)' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: GovernmentExtensionListQueryDto,
  ): Promise<Paginated<GovernmentExtensionRecord>> {
    const filter: { complianceRuleCode?: string } = {};
    if (query.complianceRuleCode) filter.complianceRuleCode = query.complianceRuleCode;
    return this.extensions
      .list(rlsContextFromPrincipal(principal), query, filter)
      .then((result) => paginate(result, query));
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.complianceRead)
  @ApiOperation({ summary: 'Get one government extension' })
  getOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GovernmentExtensionRecord> {
    return this.extensions.getOne(rlsContextFromPrincipal(principal), id);
  }

  @Post()
  @RequirePermissions(PERMISSION.complianceManage)
  @ApiOperation({
    summary: 'Import a government extension (§19; audited)',
    description:
      'Stores a government-notified revised deadline as an append-only overlay — the original ' +
      'date, revised date, notification reference, applicable population and effective date. ' +
      'It is not an edit to the rule and not a manual override.',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateGovernmentExtensionDto,
  ): Promise<GovernmentExtensionRecord> {
    return this.extensions.create(rlsContextFromPrincipal(principal), dto);
  }
}
