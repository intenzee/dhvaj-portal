import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type FilingCleanupResult,
  type InstanceWorkspace,
  type PriorFiledResult,
  type StreamTree,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import type { ClientUploadLinkCreated } from '../documents/client-upload/client-upload.service';
import { FilingWorkspaceService } from './filing-workspace.service';
import { StreamTreeService } from './stream-tree.service';
import { FilingCleanupService } from './filing-cleanup.service';
import { PriorFiledService } from '../compliance/prior-filed.service';
import {
  CompleteLodgeDto,
  CorrectionDto,
  FileDocumentDto,
  LodgeDto,
  PatchChecklistItemDto,
  PeriodCleanupDto,
  PeriodParamDto,
  PriorFiledDto,
  ReasonDto,
  SaveFiguresDto,
  SlotRequestDto,
  SlotUploadDto,
  StartFreshDto,
  StreamParamDto,
  StreamTreeQueryDto,
} from './dto/filing-workspace.dto';

/**
 * Change 5 — the year → period tree behind each stream tab. Members read;
 * RLS scopes it to the engagement team.
 */
@ApiTags('filing-workspace')
@Controller('engagements')
export class EngagementStreamsController {
  constructor(
    private readonly trees: StreamTreeService,
    private readonly workspace: FilingWorkspaceService,
    private readonly cleanup: FilingCleanupService,
    private readonly priorFiled: PriorFiledService,
  ) {}

  /**
   * Staff Workflow WF-202 — one filing's workspace addressed under its
   * engagement (the drawer's and the filing runs' read). The same service as
   * `GET /compliance-instances/:id`, so the rules stay in one place; a filing
   * on another engagement is a 404, never a cross-link.
   */
  @Get(':id/filings/:instanceId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'One filing’s workspace on this engagement (WF-202)' })
  async filing(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
  ): Promise<InstanceWorkspace> {
    const ws = await this.workspace.get(rlsContextFromPrincipal(principal), instanceId);
    if (ws.instance.engagementId !== id) throw new NotFoundException('Filing not found.');
    return ws;
  }

  @Get(':id/streams/:stream/tree')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Year view of a stream: annual strip + period rows with sections and next action',
  })
  tree(
    @CurrentPrincipal() principal: Principal,
    @Param() params: StreamParamDto,
    @Query() query: StreamTreeQueryDto,
  ): Promise<StreamTree> {
    return this.trees.tree(rlsContextFromPrincipal(principal), params.id, params.stream, {
      ...(query.registrationId ? { registrationId: query.registrationId } : {}),
      ...(query.fy ? { fy: query.fy } : {}),
    });
  }

  /**
   * "Remove this month" — the period's open filings are waived (Not
   * applicable), their open tasks cancelled and client requests waived. Lead
   * only; lodged filings stay. Restore puts them back.
   */
  @Post(':id/streams/:stream/periods/:periodKey/remove')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Remove a period’s open filings from the portal (lead)' })
  removePeriod(
    @CurrentPrincipal() principal: Principal,
    @Param() params: PeriodParamDto,
    @Body() dto: PeriodCleanupDto,
  ): Promise<FilingCleanupResult> {
    return this.cleanup.removePeriod(
      rlsContextFromPrincipal(principal),
      params.id,
      params.stream,
      params.periodKey,
      dto.registrationId ?? null,
    );
  }

  /**
   * "Filed before the portal" — months (or the year's annual returns) the
   * client filed before the portal: their open filings are marked Filed, no
   * lodgement. Lead only; Undo puts back only filings marked this way.
   */
  @Post(':id/streams/:stream/prior-filed')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Mark periods filed before the portal (lead)' })
  markPriorFiled(
    @CurrentPrincipal() principal: Principal,
    @Param() params: StreamParamDto,
    @Body() dto: PriorFiledDto,
  ): Promise<PriorFiledResult> {
    return this.priorFiled.mark(
      rlsContextFromPrincipal(principal),
      params.id,
      params.stream,
      dto.periods,
    );
  }

  @Post(':id/streams/:stream/prior-filed/undo')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Put back periods marked filed before the portal (lead)' })
  undoPriorFiled(
    @CurrentPrincipal() principal: Principal,
    @Param() params: StreamParamDto,
    @Body() dto: PriorFiledDto,
  ): Promise<PriorFiledResult> {
    return this.priorFiled.undo(
      rlsContextFromPrincipal(principal),
      params.id,
      params.stream,
      dto.periods,
    );
  }

  @Post(':id/streams/:stream/periods/:periodKey/restore')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Restore a removed period (lead)' })
  restorePeriod(
    @CurrentPrincipal() principal: Principal,
    @Param() params: PeriodParamDto,
    @Body() dto: PeriodCleanupDto,
  ): Promise<FilingCleanupResult> {
    return this.cleanup.restorePeriod(
      rlsContextFromPrincipal(principal),
      params.id,
      params.stream,
      params.periodKey,
      dto.registrationId ?? null,
    );
  }
}

/**
 * Start fresh — the Managing Partner clears every overdue filing for a period
 * that ended before a date (history is kept on the client). Preview first.
 */
@ApiTags('filing-workspace')
@Controller('filings')
export class FilingCleanupController {
  constructor(private readonly cleanup: FilingCleanupService) {}

  @Post('start-fresh')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Clear overdue filings before a date, firm-wide (MP; dryRun previews)' })
  startFresh(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: StartFreshDto,
  ): Promise<FilingCleanupResult> {
    return this.cleanup.startFresh(
      rlsContextFromPrincipal(principal),
      dto.from,
      dto.dryRun ?? false,
    );
  }
}

/**
 * Change 5 — one filing's workspace. Reads and work need `engagement.read`
 * (membership checked against RLS); waivers and early lodges are lead-only and
 * an old lodge's undo partner-only, checked in the service and again by RLS.
 */
@ApiTags('filing-workspace')
@Controller('compliance-instances')
export class FilingWorkspaceController {
  constructor(private readonly workspace: FilingWorkspaceService) {}

  @Get(':id')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'A filing’s workspace: checklist, slots, figures, task, filing, corrections',
  })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InstanceWorkspace> {
    return this.workspace.get(rlsContextFromPrincipal(principal), id);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Tick, untick or mark a step Not applicable (required steps: lead)' })
  patchItem(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: PatchChecklistItemDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.patchItem(rlsContextFromPrincipal(principal), id, itemId, dto);
  }

  @Put(':id/figures')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Save the filing’s figures (validated against its schema)' })
  saveFigures(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveFiguresDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.saveFigures(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/slots/:slot/request')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Request a slot’s document from the client (dependency + secure upload link)',
  })
  requestSlot(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('slot') slot: string,
    @Body() dto: SlotRequestDto,
  ): Promise<{ workspace: InstanceWorkspace; link: ClientUploadLinkCreated | null }> {
    return this.workspace.requestSlot(rlsContextFromPrincipal(principal), id, slot, dto);
  }

  @Post(':id/dsc-request')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Request the director’s DSC from the client (a dependency; no upload slot)',
  })
  requestDsc(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SlotRequestDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.requestDsc(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/slots/:slot/documents')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Upload a document into a slot (ticks its step)' })
  uploadToSlot(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('slot') slot: string,
    @Body() dto: SlotUploadDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.uploadToSlot(rlsContextFromPrincipal(principal), id, slot, dto);
  }

  @Post(':id/documents/:docId/slot')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'File a received document into a slot (lead, or its uploader)' })
  fileDocument(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() dto: FileDocumentDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.fileDocument(rlsContextFromPrincipal(principal), id, docId, dto.slotCode);
  }

  @Post(':id/lodge')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Record the filing (reference no., date, Nil, figures, acknowledgement)',
    description:
      'Who may lodge, and what it needs, follows the firm’s checks (Admin → Checks); with ' +
      'a check off the lodge goes ahead and the filing shows what is still to add. Closes ' +
      'the task and its clock.',
  })
  lodge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LodgeDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.lodge(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/lodge')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Add the acknowledgement or reference a lodge was recorded without',
    description: 'Anyone on the filing fills in what is missing; a lead may also replace it.',
  })
  completeLodge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteLodgeDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.completeLodge(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/lodge/undo')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Undo a lodge — lead within 24 hours, then partner; reason required' })
  undo(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.undoLodge(rlsContextFromPrincipal(principal), id, dto.reason);
  }

  @Post(':id/not-applicable')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Mark the filing Not applicable (lead; reason required)' })
  notApplicable(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.markNotApplicable(rlsContextFromPrincipal(principal), id, dto.reason);
  }

  @Post(':id/not-applicable/lift')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Lift Not applicable — back to its derived status (lead)' })
  lift(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InstanceWorkspace> {
    return this.workspace.liftNotApplicable(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/corrections')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Record that a later filing corrected this one' })
  correction(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CorrectionDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.addCorrection(rlsContextFromPrincipal(principal), id, dto);
  }
}
