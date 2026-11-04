import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type TaxAuditApplicability,
  type TaxAuditRadarRow,
  type TaxAuditRow,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FyParamPipe } from '../engagements/fy-param.pipe';
import { SaveTaxAuditApplicabilityDto, TaxAuditRadarQueryDto } from './dto/tax-audits.dto';
import { TaxAuditApplicabilityService } from './tax-audit-applicability.service';
import { TaxAuditsService } from './tax-audits.service';

/**
 * Tax Audit (Phase 3): the engagement's Tax Audit tab (F-1), the year's
 * applicability decision and the firm's radar (F-2).
 */
@ApiTags('tax-audits')
@Controller()
export class TaxAuditsController {
  constructor(
    private readonly audits: TaxAuditsService,
    private readonly applicability: TaxAuditApplicabilityService,
  ) {}

  @Get('engagements/:id/tax-audits')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "The engagement's tax audits, one a year, newest first",
    description:
      'Each with its stage, form, signing partner, UDIN and the year’s report filing (status and due date).',
  })
  forEngagement(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TaxAuditRow[]> {
    return this.audits.forEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Get('engagements/:id/tax-audit-applicability')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "The engagement's tax audit applicability decisions, newest year first",
  })
  decisions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TaxAuditApplicability[]> {
    return this.applicability.list(rlsContextFromPrincipal(principal), id);
  }

  @Put('engagements/:id/tax-audit-applicability/:fy')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Work out (and optionally override) whether a tax audit applies for a year',
    description:
      'The engagement’s partner or manager only. The calculator runs on the inputs; an override needs a reason. The year’s calendar is rebuilt when Tax Audit is in scope.',
  })
  decide(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fy', FyParamPipe) fy: string,
    @Body() body: SaveTaxAuditApplicabilityDto,
  ): Promise<TaxAuditApplicability> {
    return this.applicability.save(rlsContextFromPrincipal(principal), id, fy, body);
  }

  @Get('tax-audits/radar')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Clients likely to need a tax audit for a year, with the reason',
    description:
      'Every Compliance year the caller can see whose client is likely to need a tax audit (the decision, else the PAN profile, else turnover over ₹1 crore), or that has Tax Audit in scope. Likely years not yet in scope come first.',
  })
  radar(
    @CurrentPrincipal() principal: Principal,
    @Query() query: TaxAuditRadarQueryDto,
  ): Promise<TaxAuditRadarRow[]> {
    return this.applicability.radar(
      rlsContextFromPrincipal(principal),
      query.financialYear,
      query.all ?? false,
    );
  }
}
