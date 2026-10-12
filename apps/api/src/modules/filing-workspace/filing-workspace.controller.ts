import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type InstanceWorkspace, type StreamTree } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import type { ClientUploadLinkCreated } from '../documents/client-upload/client-upload.service';
import { FilingWorkspaceService } from './filing-workspace.service';
import { StreamTreeService } from './stream-tree.service';
import {
  CorrectionDto,
  FileDocumentDto,
  LodgeDto,
  PatchChecklistItemDto,
  ReasonDto,
  SaveFiguresDto,
  SlotRequestDto,
  SlotUploadDto,
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
  constructor(private readonly trees: StreamTreeService) {}

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
  @ApiOperation({ summary: 'A filing’s workspace: checklist, slots, figures, task, filing, corrections' })
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
  @ApiOperation({ summary: 'Request a slot’s document from the client (dependency + secure upload link)' })
  requestSlot(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('slot') slot: string,
    @Body() dto: SlotRequestDto,
  ): Promise<{ workspace: InstanceWorkspace; link: ClientUploadLinkCreated }> {
    return this.workspace.requestSlot(rlsContextFromPrincipal(principal), id, slot, dto);
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
    description: '409 unless Ready to file — a lead may lodge earlier. Closes the task and its clock.',
  })
  lodge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LodgeDto,
  ): Promise<InstanceWorkspace> {
    return this.workspace.lodge(rlsContextFromPrincipal(principal), id, dto);
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
