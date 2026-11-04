import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type TaxAuditWorkspace } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  AddTaxAuditWpCommentDto,
  MarkTaxAuditWorkingPaperNaDto,
  RequestTaxAuditInformationDto,
  ReviewTaxAuditWorkingPaperDto,
  SaveTaxAuditFactsDto,
  SaveTaxAuditWorkingPaperDto,
  TaxAuditVersionDto,
  UploadTaxAuditWpEvidenceDto,
} from './dto/tax-audit-workspace.dto';
import { TaxAuditWorkspaceService } from './tax-audit-workspace.service';

const AUDIT = 'engagements/:id/tax-audits/:auditId';
const PAPER = `${AUDIT}/clauses/:paperId`;

/**
 * Form 3CD clause workspace (Phase 4, F-5). Membership of the engagement is
 * the gate (RLS); the service decides who opens the work, prepares a clause
 * and reviews it.
 */
@ApiTags('tax-audits')
@Controller()
export class TaxAuditWorkspaceController {
  constructor(private readonly workspace: TaxAuditWorkspaceService) {}

  @Get(`${AUDIT}/clauses`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The 3CD workspace: packages, working papers and information requests' })
  get(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.get(rlsContextFromPrincipal(p), id, auditId);
  }

  @Post(`${AUDIT}/clauses/open`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Open the 3CD work on the year’s library version: packages as tasks, a paper a clause',
  })
  open(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: TaxAuditVersionDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.open(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${AUDIT}/clauses/refresh-drafts`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Draft the clauses still being prepared again from portal data (lead only)',
  })
  refreshDrafts(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: TaxAuditVersionDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.refreshDrafts(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Put(`${AUDIT}/facts`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'What the audit knows about the assessee; ruled-out clauses fall away' })
  saveFacts(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: SaveTaxAuditFactsDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.saveFacts(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${AUDIT}/information-requests`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Ask the client for the standard list (as client requests)' })
  requestInformation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: RequestTaxAuditInformationDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.requestInformation(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Put(PAPER)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Save a clause’s answer' })
  saveAnswer(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: SaveTaxAuditWorkingPaperDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.saveAnswer(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Post(`${PAPER}/confirm-draft`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Confirm the draft from the portal into the answer' })
  confirmDraft(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: TaxAuditVersionDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.confirmDraft(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Post(`${PAPER}/not-applicable`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Mark a clause Not applicable, with the reason' })
  markNotApplicable(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: MarkTaxAuditWorkingPaperNaDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.markNotApplicable(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Post(`${PAPER}/reopen`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Reopen a clause that is Not applicable, in review or done' })
  reopen(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: TaxAuditVersionDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.reopen(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Post(`${PAPER}/send-for-review`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Send a clause for review: every field answered, its evidence attached',
  })
  sendForReview(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: TaxAuditVersionDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.sendForReview(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Post(`${PAPER}/review`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Mark a clause in review done, or send it back with a comment' })
  review(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: ReviewTaxAuditWorkingPaperDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.review(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Post(`${PAPER}/comments`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Comment on a clause' })
  addComment(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: AddTaxAuditWpCommentDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.addComment(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Post(`${PAPER}/evidence`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Attach an evidence file (filed in the engagement’s documents)' })
  addEvidence(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Body() body: UploadTaxAuditWpEvidenceDto,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.addEvidence(rlsContextFromPrincipal(p), id, auditId, paperId, body);
  }

  @Delete(`${PAPER}/evidence/:documentId`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Take an evidence file off the clause (it stays in the documents)' })
  removeEvidence(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('paperId', new ParseUUIDPipe()) paperId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<TaxAuditWorkspace> {
    return this.workspace.removeEvidence(
      rlsContextFromPrincipal(p),
      id,
      auditId,
      paperId,
      documentId,
    );
  }
}
