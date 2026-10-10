import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditReportingRecords } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditReportingRecordsService } from './audit-reporting-records.service';
import {
  AddDirectorCheckDto,
  CreateFraudMatterDto,
  LinkReportingEvidenceDto,
  RecordFraudConsultationDto,
  UpdateDirectorCheckDto,
  UpdateFraudMatterDto,
} from './dto/reporting-records.dto';

/**
 * Statutory Audit — 02.7 Track B records: Section 143(12) Fraud Matters (spec
 * §14), the Section 164(2) director workpaper (§12), the 02.4 / 02.5 / 02.6
 * cross-references (§15, §17) and per-card evidence (§16). Reads gated by
 * `engagement.read`, changes by `engagement.manage`; RLS does the real gating
 * (members read; only leads change the audit file).
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId/reporting-records')
export class AuditReportingRecordsController {
  constructor(private readonly records: AuditReportingRecordsService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The 02.7 records — Fraud Matters, §164(2) directors, cross-references, evidence',
  })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.view(rlsContextFromPrincipal(principal), id, wf);
  }

  // ── §14 Fraud Matters ──────────────────────────────────────────────────

  @Post('fraud-matters')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a Fraud Matter (one central record per fraud, §14)' })
  createFraudMatter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateFraudMatterDto,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.createFraudMatter(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Patch('fraud-matters/:matterId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a Fraud Matter — facts, Rule 13 dates, conclusion, withdraw' })
  updateFraudMatter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: UpdateFraudMatterDto,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.updateFraudMatter(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      matterId,
      dto,
    );
  }

  @Post('fraud-matters/:matterId/partner-consultation')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'The Engagement Partner records the consultation on a Fraud Matter' })
  recordConsultation(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: RecordFraudConsultationDto,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.recordConsultation(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      matterId,
      dto,
    );
  }

  // ── §12 director workpaper ─────────────────────────────────────────────

  @Post('directors')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a director to the Section 164(2) workpaper' })
  addDirector(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: AddDirectorCheckDto,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.addDirector(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('directors/fill')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add the contacts-master directors not yet on the workpaper' })
  fillDirectors(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.fillDirectors(rlsContextFromPrincipal(principal), id, wf);
  }

  @Patch('directors/:directorId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a director — evidence references, legal analysis, conclusion' })
  updateDirector(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('directorId', new ParseUUIDPipe()) directorId: string,
    @Body() dto: UpdateDirectorCheckDto,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.updateDirector(rlsContextFromPrincipal(principal), id, wf, directorId, dto);
  }

  // ── §16 per-card evidence ──────────────────────────────────────────────

  @Post('evidence')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link an engagement document or Section 06 evidence to a 02.7 card' })
  linkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: LinkReportingEvidenceDto,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.linkEvidence(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('evidence/:linkId/unlink')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove an evidence link from a 02.7 card (kept in history)' })
  unlinkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.records.unlinkEvidence(rlsContextFromPrincipal(principal), id, wf, linkId);
  }
}
