import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type FileVersionHistory,
  type FrameworkEvidenceView,
  type FrameworkMemoCreated,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFrameworkEvidenceService } from './audit-framework-evidence.service';
import {
  AddFrameworkFileDto,
  CreateFrameworkMemoDto,
  LinkFrameworkFileDto,
} from './dto/framework-evidence.dto';

/**
 * Statutory Audit — Section 02 evidence and the 02.2 technical memo (DHVAJ
 * 02.2 spec §7, §18). Reads gated by
 * `engagement.read`, changes by `engagement.manage`; RLS does the real gating
 * (members read; only leads change the audit file).
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId')
export class AuditFrameworkEvidenceController {
  constructor(private readonly evidence: AuditFrameworkEvidenceService) {}

  @Get('framework/:subAssessmentId/evidence')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The evidence files of a Section 02 sub-assessment' })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('subAssessmentId', new ParseUUIDPipe()) sub: string,
  ): Promise<FrameworkEvidenceView> {
    return this.evidence.view(rlsContextFromPrincipal(principal), id, wf, sub);
  }

  @Post('framework/:subAssessmentId/evidence/add')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add File — stored in the engagement workspace and linked here' })
  add(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('subAssessmentId', new ParseUUIDPipe()) sub: string,
    @Body() dto: AddFrameworkFileDto,
  ): Promise<FrameworkEvidenceView> {
    return this.evidence.add(rlsContextFromPrincipal(principal), id, wf, sub, dto);
  }

  @Post('framework/:subAssessmentId/evidence/link')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link Existing File — an engagement document, never copied' })
  link(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('subAssessmentId', new ParseUUIDPipe()) sub: string,
    @Body() dto: LinkFrameworkFileDto,
  ): Promise<FrameworkEvidenceView> {
    return this.evidence.link(rlsContextFromPrincipal(principal), id, wf, sub, dto);
  }

  @Post('framework/:subAssessmentId/evidence/:fileId/unlink')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a file from the assessment (the document stays)' })
  unlink(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('subAssessmentId', new ParseUUIDPipe()) sub: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<FrameworkEvidenceView> {
    return this.evidence.unlink(rlsContextFromPrincipal(principal), id, wf, sub, fileId);
  }

  @Get('framework/:subAssessmentId/evidence/:fileId/versions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "The file's version history (SharePoint's when it holds the file)" })
  versions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('subAssessmentId', new ParseUUIDPipe()) sub: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<FileVersionHistory> {
    return this.evidence.versions(principal, id, wf, sub, fileId);
  }

  @Post('financial-reporting/memo')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Create the Financial Reporting Framework technical memo from the DHVAJ template',
    description:
      'Merges the 02.2 assessment facts into the approved Word template, stores it in the ' +
      'engagement workspace and links it to 02.2; returns the Microsoft 365 link when on.',
  })
  createMemo(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateFrameworkMemoDto,
  ): Promise<FrameworkMemoCreated> {
    return this.evidence.createMemo(principal, id, wf, dto);
  }
}
