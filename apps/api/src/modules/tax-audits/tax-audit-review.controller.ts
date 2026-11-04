import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type TaxAuditReview } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  DecideTaxAuditObservationDto,
  EditTaxAuditObservationDto,
  FlagTaxAuditObservationDto,
  RaiseTaxAuditReviewPointDto,
  RespondTaxAuditReviewPointDto,
  SignOffTaxAuditReviewDto,
} from './dto/tax-audit-review.dto';
import { TaxAuditVersionDto } from './dto/tax-audit-workspace.dto';
import { TaxAuditReviewService } from './tax-audit-review.service';

const AUDIT = 'engagements/:id/tax-audits/:auditId';
const REVIEW = `${AUDIT}/review`;

/**
 * Tax Audit review and observations register (Phase 5, F-7). Membership of
 * the engagement is the gate (RLS); the service decides who reviews at which
 * level and who decides what goes into the report.
 */
@ApiTags('tax-audits')
@Controller()
export class TaxAuditReviewController {
  constructor(private readonly review: TaxAuditReviewService) {}

  @Get(REVIEW)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The review chain, review points, flagged matters and what blocks signing',
  })
  get(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<TaxAuditReview> {
    return this.review.get(rlsContextFromPrincipal(p), id, auditId);
  }

  @Post(`${REVIEW}/start`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Send the 3CD for review once every clause is done or Not applicable' })
  start(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: TaxAuditVersionDto,
  ): Promise<TaxAuditReview> {
    return this.review.start(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${REVIEW}/sign-off`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Sign off a review level: Senior, then Manager, then the signing Partner',
  })
  signOff(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: SignOffTaxAuditReviewDto,
  ): Promise<TaxAuditReview> {
    return this.review.signOff(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${REVIEW}/points`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Raise a review point on a clause or the report' })
  raisePoint(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: RaiseTaxAuditReviewPointDto,
  ): Promise<TaxAuditReview> {
    return this.review.raisePoint(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${REVIEW}/points/:pointId/respond`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Respond to a review point' })
  respond(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('pointId', new ParseUUIDPipe()) pointId: string,
    @Body() body: RespondTaxAuditReviewPointDto,
  ): Promise<TaxAuditReview> {
    return this.review.respond(rlsContextFromPrincipal(p), id, auditId, pointId, body);
  }

  @Post(`${REVIEW}/points/:pointId/clear`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Clear a review point' })
  clear(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('pointId', new ParseUUIDPipe()) pointId: string,
    @Body() body: TaxAuditVersionDto,
  ): Promise<TaxAuditReview> {
    return this.review.clear(rlsContextFromPrincipal(p), id, auditId, pointId, body);
  }

  @Post(`${AUDIT}/observations`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Flag a matter that may need reporting in Form 3CA / 3CB' })
  flag(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: FlagTaxAuditObservationDto,
  ): Promise<TaxAuditReview> {
    return this.review.flag(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Put(`${AUDIT}/observations/:observationId`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Reword a flagged matter while it is undecided' })
  editObservation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('observationId', new ParseUUIDPipe()) observationId: string,
    @Body() body: EditTaxAuditObservationDto,
  ): Promise<TaxAuditReview> {
    return this.review.editObservation(
      rlsContextFromPrincipal(p),
      id,
      auditId,
      observationId,
      body,
    );
  }

  @Post(`${AUDIT}/observations/:observationId/decide`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The signing Partner: a qualification, an observation, or not for the report',
  })
  decide(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('observationId', new ParseUUIDPipe()) observationId: string,
    @Body() body: DecideTaxAuditObservationDto,
  ): Promise<TaxAuditReview> {
    return this.review.decide(rlsContextFromPrincipal(p), id, auditId, observationId, body);
  }
}
