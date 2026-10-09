import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type AcceptanceFilesView, type FileVersionHistory } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditAcceptanceFilesService } from './audit-acceptance-files.service';
import {
  AddAcceptanceFileDto,
  CreateAcceptanceFileFromTemplateDto,
  LinkAcceptanceFileDto,
  SetAcceptanceFileStatusDto,
} from './dto/acceptance-files.dto';

/**
 * Statutory Audit — Section 01 file cards (spec §2, §5.1, §6.2, §10).
 * Reads gated by `engagement.read`, changes by `engagement.manage`; RLS does
 * the real gating (members read; only leads change the audit file).
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId/acceptance/files')
export class AuditAcceptanceFilesController {
  constructor(private readonly files: AuditAcceptanceFilesService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Section 01 file cards + which firm templates are available' })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<AcceptanceFilesView> {
    return this.files.view(rlsContextFromPrincipal(principal), id, wf);
  }

  @Post('create-from-template')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Create a document from the approved DHVAJ template, engagement data merged in',
  })
  createFromTemplate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateAcceptanceFileFromTemplateDto,
  ): Promise<AcceptanceFilesView> {
    return this.files.createFromTemplate(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('add')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a file to the engagement and link it to a Section 01 slot' })
  add(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: AddAcceptanceFileDto,
  ): Promise<AcceptanceFilesView> {
    return this.files.add(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('link')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link a file the engagement already holds (no duplicate)' })
  link(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: LinkAcceptanceFileDto,
  ): Promise<AcceptanceFilesView> {
    return this.files.link(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post(':fileId/status')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Take a status step (Mark Ready / Sent / Issued, reopen with reason …)',
  })
  setStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @Body() dto: SetAcceptanceFileStatusDto,
  ): Promise<AcceptanceFilesView> {
    return this.files.setStatus(rlsContextFromPrincipal(principal), id, wf, fileId, dto);
  }

  @Post(':fileId/unlink')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Take a file out of its slot (the document stays on the engagement)' })
  unlink(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<AcceptanceFilesView> {
    return this.files.unlink(rlsContextFromPrincipal(principal), id, wf, fileId);
  }

  @Get(':fileId/versions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "The file's version history (SharePoint's when it holds the file)" })
  versions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<FileVersionHistory> {
    return this.files.versions(principal, id, wf, fileId);
  }
}
