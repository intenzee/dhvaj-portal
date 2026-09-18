import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditReview } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditReviewService } from './audit-review.service';
import {
  ClearReviewNoteDto,
  RaiseReviewNoteDto,
  RespondReviewNoteDto,
  UpdateReviewNoteDto,
} from './dto/review.dto';

/**
 * Statutory Audit — Review endpoints (Audit Spec §25, §344). Review is
 * first-class: the pending-review queue and headline counts are derived from
 * procedure/area state; review notes move open → responded → cleared. Reads
 * gated by `engagement.read`, mutations by `engagement.manage`; RLS does the real
 * gating (members read; only leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditReviewController {
  constructor(private readonly review: AuditReviewService) {}

  @Get(':id/statutory-audit/review')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's Review dashboard — queue + notes (§25)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditReview[]> {
    return this.review.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/review/notes')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a review note on a procedure/area/evidence (§344)' })
  raise(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RaiseReviewNoteDto,
  ): Promise<StatutoryAuditReview> {
    return this.review.raiseNote(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/review/notes/:noteId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Edit a review note (§344)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
    @Body() dto: UpdateReviewNoteDto,
  ): Promise<StatutoryAuditReview> {
    return this.review.updateNote(rlsContextFromPrincipal(principal), id, noteId, dto);
  }

  @Post(':id/statutory-audit/review/notes/:noteId/respond')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Respond to a review note (§344)' })
  respond(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
    @Body() dto: RespondReviewNoteDto,
  ): Promise<StatutoryAuditReview> {
    return this.review.respondNote(rlsContextFromPrincipal(principal), id, noteId, dto);
  }

  @Post(':id/statutory-audit/review/notes/:noteId/clear')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Clear a review note (§25)' })
  clear(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
    @Body() dto: ClearReviewNoteDto,
  ): Promise<StatutoryAuditReview> {
    return this.review.clearNote(rlsContextFromPrincipal(principal), id, noteId, dto);
  }

  @Delete(':id/statutory-audit/review/notes/:noteId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Delete a review note (§344)' })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ): Promise<StatutoryAuditReview> {
    return this.review.deleteNote(rlsContextFromPrincipal(principal), id, noteId);
  }
}
