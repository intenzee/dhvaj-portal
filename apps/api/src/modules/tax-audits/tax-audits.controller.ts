import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type TaxAuditAcceptance,
  type TaxAuditBoard,
  type TaxAuditMilestones,
  type TaxAuditApplicability,
  type TaxAuditRadarRow,
  type TaxAuditRow,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FyParamPipe } from '../engagements/fy-param.pipe';
import {
  SaveTaxAuditAcceptanceDto,
  SaveTaxAuditApplicabilityDto,
  SaveTaxAuditMilestoneDto,
  TaxAuditAcceptanceStepDto,
  TaxAuditBoardQueryDto,
  TaxAuditRadarQueryDto,
  UploadPreviousAuditorLetterDto,
} from './dto/tax-audits.dto';
import { TaxAuditAcceptanceService } from './tax-audit-acceptance.service';
import { TaxAuditApplicabilityService } from './tax-audit-applicability.service';
import { TaxAuditMilestonesService } from './tax-audit-milestones.service';
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
    private readonly acceptance: TaxAuditAcceptanceService,
    private readonly milestones: TaxAuditMilestonesService,
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

  @Get('engagements/:id/tax-audits/:auditId/acceptance')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The tax audit’s acceptance desk (F-3)',
    description:
      'The s.44AB independence check, the previous auditor, the form, the signing partners (each with their count for the year against the firm’s limit, and whether they may be chosen) and the appointment letter.',
  })
  acceptanceView(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<TaxAuditAcceptance> {
    return this.acceptance.get(rlsContextFromPrincipal(principal), id, auditId);
  }

  @Put('engagements/:id/tax-audits/:auditId/acceptance')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Set the form, the signing partner and the previous auditor',
    description:
      'The engagement’s partner or manager only. A partner without a valid COP, or already at the firm’s limit for the year, is refused with the count.',
  })
  saveAcceptance(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: SaveTaxAuditAcceptanceDto,
  ): Promise<TaxAuditAcceptance> {
    return this.acceptance.save(rlsContextFromPrincipal(principal), id, auditId, body);
  }

  @Post('engagements/:id/tax-audits/:auditId/acceptance/previous-auditor-letter')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Upload the written communication to the previous auditor' })
  uploadPreviousAuditorLetter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: UploadPreviousAuditorLetterDto,
  ): Promise<TaxAuditAcceptance> {
    return this.acceptance.uploadPreviousAuditorLetter(
      rlsContextFromPrincipal(principal),
      id,
      auditId,
      body,
    );
  }

  @Post('engagements/:id/tax-audits/:auditId/acceptance/appointment-letter')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Make the appointment letter from the firm’s approved template',
  })
  createAppointmentLetter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: TaxAuditAcceptanceStepDto,
  ): Promise<TaxAuditAcceptance> {
    return this.acceptance.createAppointmentLetter(
      rlsContextFromPrincipal(principal),
      id,
      auditId,
      body,
    );
  }

  @Post('engagements/:id/tax-audits/:auditId/acceptance/accept')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Accept the tax audit and move it on to Information from client',
    description: 'Refused, with what is missing, until every acceptance step is done.',
  })
  accept(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: TaxAuditAcceptanceStepDto,
  ): Promise<TaxAuditAcceptance> {
    return this.acceptance.accept(rlsContextFromPrincipal(principal), id, auditId, body);
  }

  @Get('tax-audits/board')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The firm’s tax audit board for a year (Managing Partner and Partners)',
    description:
      'Stage counts (Not started, In progress, Completed), the audits at risk — a missed internal milestone, or past the due date with the s.271B exposure — and each partner’s reports against the limit. Read under the caller’s RLS.',
  })
  board(
    @CurrentPrincipal() principal: Principal,
    @Query() query: TaxAuditBoardQueryDto,
  ): Promise<TaxAuditBoard> {
    return this.milestones.board(rlsContextFromPrincipal(principal), query.financialYear);
  }

  @Get('engagements/:id/tax-audits/:auditId/milestones')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The tax audit’s internal milestones, counted back from the due date',
  })
  getMilestones(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<TaxAuditMilestones> {
    return this.milestones.get(rlsContextFromPrincipal(principal), id, auditId);
  }

  @Put('engagements/:id/tax-audits/:auditId/milestones/:milestone')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Tick a milestone done (or not), or name who answers for it',
    description:
      'Its owner or the engagement’s partner or manager ticks the milestones no desk moves yet (information requests, information received, clause work, review); the partner or manager names an owner.',
  })
  saveMilestone(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('milestone') milestone: string,
    @Body() body: SaveTaxAuditMilestoneDto,
  ): Promise<TaxAuditMilestones> {
    return this.milestones.save(rlsContextFromPrincipal(principal), id, auditId, milestone, body);
  }
}
