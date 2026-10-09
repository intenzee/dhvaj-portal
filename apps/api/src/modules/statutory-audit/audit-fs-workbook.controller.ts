import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type FileVersionHistory,
  type FsWorkbookCreated,
  type FsWorkbookView,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFsWorkbookService } from './audit-fs-workbook.service';
import { CreateFsWorkbookDto } from './dto/fs-workbook.dto';

/**
 * Statutory Audit — the Financial Statements Workbook (DHVAJ 02.3 spec §16).
 * Reads gated by `engagement.read`, creation by `engagement.manage`; RLS does
 * the real gating (members read; only leads create).
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId/schedule-iii/workbook')
export class AuditFsWorkbookController {
  constructor(private readonly workbooks: AuditFsWorkbookService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The FS workbook: the template it would use, or the one created, with its metadata',
  })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<FsWorkbookView> {
    return this.workbooks.view(rlsContextFromPrincipal(principal), id, wf);
  }

  @Post()
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Create Financial Statements Workbook from the approved DHVAJ Excel template',
    description:
      'Selects the template by framework + Division + entity type + financial year + template ' +
      'effective version, creates it in the engagement workspace (SharePoint when Microsoft 365 ' +
      'is on) and records the template / framework version; returns the Microsoft 365 link.',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateFsWorkbookDto,
  ): Promise<FsWorkbookCreated> {
    return this.workbooks.create(principal, id, wf, dto);
  }

  @Get('versions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "The workbook's version history (SharePoint's when it holds the file)" })
  versions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<FileVersionHistory> {
    return this.workbooks.versions(principal, id, wf);
  }
}
