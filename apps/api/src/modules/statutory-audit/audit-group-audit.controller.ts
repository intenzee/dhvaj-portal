import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ComponentInstructionsCreated,
  type ConsolidationWorkProgramme,
  type FileVersionHistory,
  type PackageDocumentKey,
  type StatutoryAuditGroupAudit,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditGroupAuditService } from './audit-group-audit.service';
import {
  AddGroupAuditFileDto,
  CreateComponentInstructionsDto,
  CreateGroupAuditBranchDto,
  CreateGroupAuditFindingDto,
  LinkGroupAuditFileDto,
  UpdateGroupAuditBranchDto,
  UpdateGroupAuditComponentDto,
  UpdateGroupAuditDto,
  UpdateGroupAuditFindingDto,
  UpdatePackageDocumentDto,
} from './dto/group-audit.dto';

/**
 * Statutory Audit — 02.6 Part B, the group / component / branch auditor
 * framework (DHVAJ 02.6 spec §12–§17, §19). Reads gated by `engagement.read`,
 * changes by `engagement.manage`; RLS does the real gating (members read; only
 * leads change the audit file).
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId/group-audit')
export class AuditGroupAuditController {
  constructor(private readonly groupAudit: AuditGroupAuditService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The 02.6 group-audit framework — component auditor matrix, branches, findings',
  })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.view(rlsContextFromPrincipal(principal), id, wf);
  }

  @Patch()
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Answer GA-01 (SA 600 involvement) or BR-01 (branch auditors)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: UpdateGroupAuditDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.update(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Patch('components/:rowId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a component auditor row (§12) and its GA-02..04 answers (§13)' })
  updateComponent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('rowId', new ParseUUIDPipe()) rowId: string,
    @Body() dto: UpdateGroupAuditComponentDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.updateComponent(rlsContextFromPrincipal(principal), id, wf, rowId, dto);
  }

  @Patch('components/:rowId/package/:key')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Set the status of a reporting-package document (§15)' })
  updatePackage(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('rowId', new ParseUUIDPipe()) rowId: string,
    @Param('key') key: string,
    @Body() dto: UpdatePackageDocumentDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.updatePackage(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      rowId,
      key as PackageDocumentKey,
      dto,
    );
  }

  @Post('components/:rowId/instructions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Create the Component Auditor Instructions (§14)',
    description:
      'Merges the component, group and approved-materiality facts into the approved Word ' +
      'template, stores it in the engagement workspace and links it to the component; returns ' +
      'the Microsoft 365 link when on.',
  })
  createInstructions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('rowId', new ParseUUIDPipe()) rowId: string,
    @Body() dto: CreateComponentInstructionsDto,
  ): Promise<ComponentInstructionsCreated> {
    return this.groupAudit.createInstructions(principal, id, wf, rowId, dto);
  }

  @Post('files/add')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add File — stored in the engagement workspace and linked to a slot' })
  addFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: AddGroupAuditFileDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.addFile(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('files/link')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link Existing File — an engagement document, never copied' })
  linkFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: LinkGroupAuditFileDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.linkFile(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Get('files/:fileId/versions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "A linked file's version history (SharePoint's when it holds the file)",
  })
  fileVersions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<FileVersionHistory> {
    return this.groupAudit.fileVersions(principal, id, wf, fileId);
  }

  @Post('findings')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a component / branch finding (§16)' })
  createFinding(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateGroupAuditFindingDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.createFinding(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Patch('findings/:findingId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update, resolve or withdraw a finding (§16)' })
  updateFinding(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('findingId', new ParseUUIDPipe()) findingId: string,
    @Body() dto: UpdateGroupAuditFindingDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.updateFinding(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      findingId,
      dto,
    );
  }

  @Post('branches')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a branch auditor record (§17)' })
  createBranch(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateGroupAuditBranchDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.createBranch(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Patch('branches/:branchId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update or withdraw a branch auditor record (§17)' })
  updateBranch(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: UpdateGroupAuditBranchDto,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.groupAudit.updateBranch(rlsContextFromPrincipal(principal), id, wf, branchId, dto);
  }

  @Get('work-programme')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The 15-item consolidation work programme and its Section 06 links (§19)',
  })
  workProgramme(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<ConsolidationWorkProgramme> {
    return this.groupAudit.workProgramme(rlsContextFromPrincipal(principal), id, wf);
  }
}
