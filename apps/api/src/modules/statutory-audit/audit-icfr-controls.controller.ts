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
  type IcfrLibraryArea,
  type IcfrReportingSummary,
  type StatutoryAuditIcfrConsolidated,
  type StatutoryAuditIcfrWorkstream,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditIcfrControlsService } from './audit-icfr-controls.service';
import {
  AddIcfrComponentDto,
  AddIcfrProcessAreaDto,
  ConcludeIcfrConsolidatedDto,
  ConcludeIcfrWorkstreamDto,
  CreateIcfrControlDto,
  CreateIcfrDeficiencyDto,
  LinkIcfrControlEvidenceDto,
  ReviewIcfrControlDto,
  ReviewIcfrDeficiencyDto,
  UpdateIcfrComponentDto,
  UpdateIcfrControlDto,
  UpdateIcfrDeficiencyDto,
  UpdateIcfrFollowUpDto,
  UpdateIcfrProcessAreaDto,
} from './dto/icfr-controls.dto';

const uuid = () => new ParseUUIDPipe();
const BASE = 'engagements/:id/statutory-audit/:workflowInstanceId';

/**
 * Statutory Audit — 02.5 ICFR workstream and consolidated ICFR consideration
 * (DHVAJ 02.5 spec §13–§17, §19, §22). Reads gated by `engagement.read`,
 * changes by `engagement.manage`; RLS does the real gating (members read;
 * only leads change the audit file; the Engagement Partner concludes).
 */
@ApiTags('engagements')
@Controller()
export class AuditIcfrControlsController {
  constructor(private readonly icfr: AuditIcfrControlsService) {}

  @Get('icfr-process-area-library')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The ICFR process-area framework in force on a date (default: today)' })
  library(
    @CurrentPrincipal() principal: Principal,
    @Query('on') on?: string,
  ): Promise<IcfrLibraryArea[]> {
    const date = on ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException('`on` must be YYYY-MM-DD.');
    return this.icfr.library(rlsContextFromPrincipal(principal), date);
  }

  @Get(`${BASE}/icfr/workstream`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The Section 05 ICFR workstream, control register and deficiency register',
    description:
      'Instantiates the versioned process-area framework on read once 02.5 concludes section ' +
      '143(3)(i) reporting applies, and withdraws it if 02.5 later concludes Exempt.',
  })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.view(rlsContextFromPrincipal(principal), id, wf);
  }

  @Get(`${BASE}/icfr/consolidated`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The Consolidated ICFR Reporting Consideration (02.6 components)' })
  consolidated(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.icfr.consolidatedView(rlsContextFromPrincipal(principal), id, wf);
  }

  @Get(`${BASE}/icfr/reporting`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'ICFR conclusion and MW / SD for Section 07 / 08' })
  reporting(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
  ): Promise<IcfrReportingSummary | null> {
    return this.icfr.reporting(rlsContextFromPrincipal(principal), id, wf);
  }

  @Patch(`${BASE}/icfr/process-areas/:areaId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Scope a process area (the team decision stands over the suggestion)' })
  updateArea(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('areaId', uuid()) areaId: string,
    @Body() dto: UpdateIcfrProcessAreaDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.updateArea(rlsContextFromPrincipal(principal), id, wf, areaId, dto);
  }

  @Post(`${BASE}/icfr/process-areas`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a further significant process identified by risk / scoping' })
  addArea(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Body() dto: AddIcfrProcessAreaDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.addArea(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post(`${BASE}/icfr/controls`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record a control (FS audit, ICFR or both — one record)' })
  createControl(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Body() dto: CreateIcfrControlDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.createControl(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Patch(`${BASE}/icfr/controls/:controlId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Update a control: design, implementation, operating effectiveness kept separate',
  })
  updateControl(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('controlId', uuid()) controlId: string,
    @Body() dto: UpdateIcfrControlDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.updateControl(rlsContextFromPrincipal(principal), id, wf, controlId, dto);
  }

  @Post(`${BASE}/icfr/controls/:controlId/review`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Submit / return / review / reopen a control' })
  reviewControl(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('controlId', uuid()) controlId: string,
    @Body() dto: ReviewIcfrControlDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.reviewControl(rlsContextFromPrincipal(principal), id, wf, controlId, dto);
  }

  @Post(`${BASE}/icfr/controls/:controlId/evidence`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link existing evidence to a control — never a copy' })
  linkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('controlId', uuid()) controlId: string,
    @Body() dto: LinkIcfrControlEvidenceDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.linkEvidence(rlsContextFromPrincipal(principal), id, wf, controlId, dto);
  }

  @Post(`${BASE}/icfr/controls/:controlId/evidence/:linkId/unlink`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove an evidence link from a control (the evidence stays)' })
  unlinkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('controlId', uuid()) controlId: string,
    @Param('linkId', uuid()) linkId: string,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.unlinkEvidence(rlsContextFromPrincipal(principal), id, wf, controlId, linkId);
  }

  @Post(`${BASE}/icfr/deficiencies`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a deficiency (CD / SD / MW) in the register' })
  createDeficiency(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Body() dto: CreateIcfrDeficiencyDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.createDeficiency(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Patch(`${BASE}/icfr/deficiencies/:deficiencyId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a deficiency: evaluation, remediation, impact' })
  updateDeficiency(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('deficiencyId', uuid()) deficiencyId: string,
    @Body() dto: UpdateIcfrDeficiencyDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.updateDeficiency(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      deficiencyId,
      dto,
    );
  }

  @Post(`${BASE}/icfr/deficiencies/:deficiencyId/review`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Manager review / Partner conclusion (SD, MW) / reopen' })
  reviewDeficiency(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('deficiencyId', uuid()) deficiencyId: string,
    @Body() dto: ReviewIcfrDeficiencyDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.reviewDeficiency(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      deficiencyId,
      dto,
    );
  }

  @Patch(`${BASE}/icfr/follow-ups/:followUpId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Conclude the follow-up of a prior-year deficiency' })
  updateFollowUp(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('followUpId', uuid()) followUpId: string,
    @Body() dto: UpdateIcfrFollowUpDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.updateFollowUp(rlsContextFromPrincipal(principal), id, wf, followUpId, dto);
  }

  @Post(`${BASE}/icfr/workstream/conclusion`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Engagement Partner: conclude (or reopen) the ICFR workstream' })
  concludeWorkstream(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Body() dto: ConcludeIcfrWorkstreamDto,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.icfr.concludeWorkstream(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post(`${BASE}/icfr/consolidated/components`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Consolidated ICFR: add a component company' })
  addComponent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Body() dto: AddIcfrComponentDto,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.icfr.addComponent(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Patch(`${BASE}/icfr/consolidated/components/:componentId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      "Consolidated ICFR: a component's applicability, auditor, report and material weakness",
  })
  updateComponent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Param('componentId', uuid()) componentId: string,
    @Body() dto: UpdateIcfrComponentDto,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.icfr.updateComponent(rlsContextFromPrincipal(principal), id, wf, componentId, dto);
  }

  @Post(`${BASE}/icfr/consolidated/conclusion`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Engagement Partner: conclude (or reopen) the consolidated ICFR consideration',
  })
  concludeConsolidated(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid()) id: string,
    @Param('workflowInstanceId', uuid()) wf: string,
    @Body() dto: ConcludeIcfrConsolidatedDto,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.icfr.concludeConsolidated(rlsContextFromPrincipal(principal), id, wf, dto);
  }
}
