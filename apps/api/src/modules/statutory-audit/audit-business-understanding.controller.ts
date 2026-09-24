import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  UNDERSTANDING_SECTIONS,
  type BusinessUnderstandingSummary,
  type CustomMetricRecord,
  type InvestigationCardRecord,
  type PlanningExpectationRecord,
  type UnderstandingSectionKey,
  type UnderstandingSectionRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditBusinessUnderstandingService } from './audit-business-understanding.service';
import {
  AddCustomMetricDto,
  AssessInvestigationDto,
  CreatePlanningExpectationDto,
  SaveFinancialValuesDto,
  UpdateBusinessUnderstandingDto,
  UpdateFinancialDatasetDto,
  UpdatePlanningExpectationDto,
  UpdateUnderstandingSectionDto,
} from './dto/business-understanding.dto';

/**
 * Statutory Audit — 03.2 Business Understanding & Preliminary Analytics.
 * Reads gated by `engagement.read`, mutations by `engagement.manage`; RLS does
 * the real gating (members read; EP/manager leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditBusinessUnderstandingController {
  constructor(private readonly understanding: AuditBusinessUnderstandingService) {}

  @Get(':id/statutory-audit/:workflowInstanceId/business-understanding')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.2 — sections, dataset, analytics and completion checklist' })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.getSummary(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update the industry profile, conclusion and BA-01' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdateBusinessUnderstandingDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.updateRecord(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/conclusion-draft')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Draft the understanding & analytics conclusion (not persisted)' })
  conclusionDraft(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<{ draft: string }> {
    return this.understanding.draftConclusion(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/sections/:sectionKey')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Save a 03.2.1–03.2.6 understanding section' })
  saveSection(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('sectionKey') sectionKey: string,
    @Body() dto: UpdateUnderstandingSectionDto,
  ): Promise<UnderstandingSectionRecord> {
    if (!UNDERSTANDING_SECTIONS.includes(sectionKey as UnderstandingSectionKey)) {
      throw new NotFoundException('Unknown 03.2 section.');
    }
    return this.understanding.saveSection(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      sectionKey as UnderstandingSectionKey,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-dataset')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Save the 03.2.7 dataset header (period, currency, units, sources)' })
  saveDataset(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdateFinancialDatasetDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.saveDataset(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-dataset/values')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Save dataset figures (manual; no TB import in v1)',
    description: 'Recalculates analytics and reopens affected Investigation Cards.',
  })
  saveValues(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SaveFinancialValuesDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.saveValues(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-dataset/custom-metrics')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a Manager custom metric' })
  addCustomMetric(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: AddCustomMetricDto,
  ): Promise<CustomMetricRecord> {
    return this.understanding.addCustomMetric(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto.label,
    );
  }

  @Get(':id/statutory-audit/:workflowInstanceId/analytics-exceptions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.2.9 Investigation Cards' })
  listExceptions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<InvestigationCardRecord[]> {
    return this.understanding.listExceptions(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/analytics-exceptions/:cardId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record an investigation (explanation, assessment, signal decision)' })
  assessException(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body() dto: AssessInvestigationDto,
  ): Promise<InvestigationCardRecord> {
    return this.understanding.assessException(rlsContextFromPrincipal(principal), id, cardId, dto);
  }

  @Get(':id/statutory-audit/:workflowInstanceId/planning-expectations')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '§14 Expectation vs actual' })
  listExpectations(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningExpectationRecord[]> {
    return this.understanding.listExpectations(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-expectations')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record a planning expectation' })
  createExpectation(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePlanningExpectationDto,
  ): Promise<PlanningExpectationRecord> {
    return this.understanding.createExpectation(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/planning-expectations/:expectationId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Confirm investigation need / planning conclusion' })
  updateExpectation(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('expectationId', new ParseUUIDPipe()) expectationId: string,
    @Body() dto: UpdatePlanningExpectationDto,
  ): Promise<PlanningExpectationRecord> {
    return this.understanding.updateExpectation(
      rlsContextFromPrincipal(principal),
      id,
      expectationId,
      dto,
    );
  }
}
