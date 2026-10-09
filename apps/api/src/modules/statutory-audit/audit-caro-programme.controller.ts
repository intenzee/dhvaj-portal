import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type CaroClauseLibraryView,
  type CaroReportingSummary,
  type StatutoryAuditCaroProgramme,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditCaroProgrammeService } from './audit-caro-programme.service';
import {
  AddCaroComponentDto,
  CaroClauseReviewDto,
  CreateCaroFindingDto,
  LinkCaroClauseEvidenceDto,
  UpdateCaroClauseDto,
  UpdateCaroComponentDto,
  UpdateCaroFindingDto,
} from './dto/caro-programme.dto';

const uuid = () => new ParseUUIDPipe();

/**
 * Statutory Audit — 02.4 CARO clause work programme (DHVAJ 02.4 spec §11–§15,
 * §18). Reads gated by `engagement.read`, changes by `engagement.manage`; RLS
 * does the real gating (members read; only leads change the audit file).
 */
@ApiTags('engagements')
@Controller()
export class AuditCaroProgrammeController {
  constructor(private readonly programme: AuditCaroProgrammeService) {}

  @Get('caro-clause-library')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The CARO clause library in force on a date (default: today)' })
  library(
    @CurrentPrincipal() principal: Principal,
    @Query('on') on?: string,
  ): Promise<CaroClauseLibraryView> {
    const date = on ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException('`on` must be YYYY-MM-DD.');
    return this.programme.library(rlsContextFromPrincipal(principal), date);
  }

  @Get('engagements/:id/statutory-audit/:workflowInstanceId/caro/programme')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The 02.4 CARO clause work programme',
    description:
      'Instantiates the versioned clause library on read once 02.4 concludes CARO applies ' +
      '(standalone paragraph 3; clause 3(xxi) for the CFS) and withdraws it if CARO is later ' +
      'concluded not applicable.',
  })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.view(rlsContextFromPrincipal(principal), id, wf);
  }

  @Get('engagements/:id/statutory-audit/:workflowInstanceId/caro/annexure')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The draft CARO annexure from the approved clause conclusions' })
  annexure(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
  ): Promise<CaroReportingSummary> {
    return this.programme.annexure(rlsContextFromPrincipal(principal), id, wf);
  }

  @Patch('engagements/:id/statutory-audit/:workflowInstanceId/caro/clauses/:itemId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record clause work: relevance, response, draft reporting, conclusion' })
  updateClause(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('itemId', uuid()) itemId: string,
    @Body() dto: UpdateCaroClauseDto,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.updateClause(rlsContextFromPrincipal(principal), id, wf, itemId, dto);
  }

  @Post('engagements/:id/statutory-audit/:workflowInstanceId/caro/clauses/:itemId/review')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Submit / approve / return / reopen a clause conclusion; Partner review',
  })
  review(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('itemId', uuid()) itemId: string,
    @Body() dto: CaroClauseReviewDto,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.review(rlsContextFromPrincipal(principal), id, wf, itemId, dto);
  }

  @Post('engagements/:id/statutory-audit/:workflowInstanceId/caro/clauses/:itemId/evidence')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Link existing evidence (document or Section 06 record) — never a copy',
  })
  linkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('itemId', uuid()) itemId: string,
    @Body() dto: LinkCaroClauseEvidenceDto,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.linkEvidence(rlsContextFromPrincipal(principal), id, wf, itemId, dto);
  }

  @Post(
    'engagements/:id/statutory-audit/:workflowInstanceId/caro/clauses/:itemId/evidence/:linkId/unlink',
  )
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove an evidence link from a clause (the evidence stays)' })
  unlinkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('itemId', uuid()) itemId: string,
    @Param('linkId', uuid()) linkId: string,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.unlinkEvidence(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      itemId,
      linkId,
    );
  }

  @Post('engagements/:id/statutory-audit/:workflowInstanceId/caro/clauses/:itemId/findings')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a clause finding (linked to clause, audit area and reporting)' })
  createFinding(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('itemId', uuid()) itemId: string,
    @Body() dto: CreateCaroFindingDto,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.createFinding(rlsContextFromPrincipal(principal), id, wf, itemId, dto);
  }

  @Patch('engagements/:id/statutory-audit/:workflowInstanceId/caro/findings/:findingId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a clause finding or its management response' })
  updateFinding(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('findingId', uuid()) findingId: string,
    @Body() dto: UpdateCaroFindingDto,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.updateFinding(rlsContextFromPrincipal(principal), id, wf, findingId, dto);
  }

  @Post('engagements/:id/statutory-audit/:workflowInstanceId/caro/clauses/:itemId/components')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Clause 3(xxi): add a company included in the CFS' })
  addComponent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('itemId', uuid()) itemId: string,
    @Body() dto: AddCaroComponentDto,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.addComponent(rlsContextFromPrincipal(principal), id, wf, itemId, dto);
  }

  @Patch('engagements/:id/statutory-audit/:workflowInstanceId/caro/components/:componentId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: "Clause 3(xxi): a component's CARO applicability, report and remarks" })
  updateComponent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('componentId', uuid()) componentId: string,
    @Body() dto: UpdateCaroComponentDto,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.programme.updateComponent(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      componentId,
      dto,
    );
  }
}
