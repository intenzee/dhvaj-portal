import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditCompletion } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditCompletionService } from './audit-completion.service';
import { ArchiveFileDto, CompletionMemoDto, UpdateCompletionItemDto } from './dto/completion.dto';

/**
 * Statutory Audit — Completion / Reporting / Sign-off / Archive endpoints
 * (Audit Spec §27–§29). Reads gated by `engagement.read`, mutations by
 * `engagement.manage`; RLS does the real gating (members read; only leads
 * mutate). The professional §28/§29 action gates are enforced in the service.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditCompletionController {
  constructor(private readonly completion: AuditCompletionService) {}

  @Get(':id/statutory-audit/completion')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's Completion / Reporting / Sign-off dashboard (§27)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditCompletion[]> {
    return this.completion.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/completion/items/:itemId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a completion / reporting checklist item (§27.07/§27.08)' })
  updateItem(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: UpdateCompletionItemDto,
  ): Promise<StatutoryAuditCompletion> {
    return this.completion.updateItem(rlsContextFromPrincipal(principal), id, itemId, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/completion/approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Approve Completion — freeze the phase and unlock Reporting (§28)' })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CompletionMemoDto,
  ): Promise<StatutoryAuditCompletion> {
    return this.completion.approveCompletion(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/sign-off')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Partner sign-off — gated by §29 (blocking notes, areas, checklists)' })
  signOff(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CompletionMemoDto,
  ): Promise<StatutoryAuditCompletion> {
    return this.completion.signOff(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/archive')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Archive + lock the audit file (§27.10, §37)' })
  archive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ArchiveFileDto,
  ): Promise<StatutoryAuditCompletion> {
    return this.completion.archive(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }
}
