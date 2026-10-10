import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentTemplatesModule } from '../document-templates/document-templates.module';
import { StatutoryAuditWorkflowService } from './statutory-audit-workflow.service';
import { StatutoryAuditController } from './statutory-audit.controller';
import { AuditAcceptanceService } from './audit-acceptance.service';
import { AuditAcceptanceController } from './audit-acceptance.controller';
import { AuditAcceptanceFilesService } from './audit-acceptance-files.service';
import { AuditAcceptanceFilesController } from './audit-acceptance-files.controller';
import { AuditAcceptanceSignoffService } from './audit-acceptance-signoff.service';
import { AuditAcceptanceSignoffController } from './audit-acceptance-signoff.controller';
import { AuditProfileService } from './audit-profile.service';
import { AuditProfileController } from './audit-profile.controller';
import { AuthorityProvisionsController } from './authority-provisions.controller';
import { AuditFinancialReportingService } from './audit-financial-reporting.service';
import { AuditFinancialReportingController } from './audit-financial-reporting.controller';
import { AuditFrameworkDownstreamController } from './audit-framework-downstream.controller';
import { AuditFrameworkDownstreamService } from './audit-framework-downstream.service';
import { AuditFrameworkEvidenceController } from './audit-framework-evidence.controller';
import { AuditFrameworkEvidenceService } from './audit-framework-evidence.service';
import { AuditScheduleIiiService } from './audit-schedule-iii.service';
import { AuditFsWorkbookController } from './audit-fs-workbook.controller';
import { AuditFsWorkbookService } from './audit-fs-workbook.service';
import { AuditScheduleIiiController } from './audit-schedule-iii.controller';
import { AuditCaroService } from './audit-caro.service';
import { AuditCaroController } from './audit-caro.controller';
import { AuditCaroProgrammeService } from './audit-caro-programme.service';
import { AuditCaroProgrammeController } from './audit-caro-programme.controller';
import { AuditIcfrService } from './audit-icfr.service';
import { AuditIcfrController } from './audit-icfr.controller';
import { AuditIcfrControlsService } from './audit-icfr-controls.service';
import { AuditIcfrControlsController } from './audit-icfr-controls.controller';
import { AuditConsolidationService } from './audit-consolidation.service';
import { AuditConsolidationController } from './audit-consolidation.controller';
import { AuditGroupAuditService } from './audit-group-audit.service';
import { AuditGroupAuditController } from './audit-group-audit.controller';
import { AuditReportingRecordsService } from './audit-reporting-records.service';
import { AuditReportingRecordsController } from './audit-reporting-records.controller';
import { AuditOtherReportingService } from './audit-other-reporting.service';
import { AuditOtherReportingController } from './audit-other-reporting.controller';
import { AuditFrameworkSummaryService } from './audit-framework-summary.service';
import { AuditFrameworkSummaryController } from './audit-framework-summary.controller';
import { AuditRollForwardService } from './audit-rollforward.service';
import { AuditRollForwardController } from './audit-rollforward.controller';
import { AuditFrameworkService } from './audit-framework.service';
import { AuditFrameworkController } from './audit-framework.controller';
import { AuditMattersService } from './audit-matters.service';
import { AuditMattersController } from './audit-matters.controller';
import { AuditWorkService } from './audit-work.service';
import { AuditWorkController } from './audit-work.controller';
import { AuditPlanningService } from './audit-planning.service';
import { AuditPlanningController } from './audit-planning.controller';
import { AuditPlanningIntelligenceService } from './audit-planning-intelligence.service';
import { AuditPlanningIntelligenceController } from './audit-planning-intelligence.controller';
import { AuditPlanningStrategyService } from './audit-planning-strategy.service';
import { AuditPlanningStrategyController } from './audit-planning-strategy.controller';
import { AuditBusinessUnderstandingService } from './audit-business-understanding.service';
import { AuditBusinessUnderstandingController } from './audit-business-understanding.controller';
import { AuditMaterialityService } from './audit-materiality.service';
import { AuditMaterialityController } from './audit-materiality.controller';
import { AuditScopeApproachService } from './audit-scope-approach.service';
import { AuditScopeApproachController } from './audit-scope-approach.controller';
import { AuditAreaReviewService } from './audit-area-review.service';
import { AuditAreaReviewController } from './audit-area-review.controller';
import { AuditRiskService } from './audit-risk.service';
import { AuditRiskController } from './audit-risk.controller';
import { AuditProcedureService } from './audit-procedure.service';
import { AuditProcedureController } from './audit-procedure.controller';
import { AuditPbcService } from './audit-pbc.service';
import { AuditPbcController } from './audit-pbc.controller';
import { AuditReviewService } from './audit-review.service';
import { AuditReviewController } from './audit-review.controller';
import { AuditTeamService } from './audit-team.service';
import { AuditTeamController } from './audit-team.controller';
import { AuditCompletionService } from './audit-completion.service';
import { AuditCompletionController } from './audit-completion.controller';
import { AuditReassessmentService } from './audit-reassessment.service';
import { AuditReassessmentController } from './audit-reassessment.controller';
import { AuditUndoService } from './audit-undo.service';
import { AuditUndoController } from './audit-undo.controller';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ChangeSetInterceptor } from '../../common/context/change-set.interceptor';

/**
 * Statutory Audit — the professional audit-file experience (Audit Spec §5–§8).
 *
 * SA-1 lands the foundation: a versioned workflow shell (ten-phase audit-file
 * skeleton) provisioned when Statutory Audit is added to an engagement, plus the
 * read surface for the Services readiness strip and the Work-tab left panel.
 *
 * Deliberately imports only AuditModule (not EngagementsModule) so
 * EngagementsModule can depend on THIS module to provision at add-service time
 * without a circular import. See migration 1762100000000.
 */
@Module({
  imports: [AuditModule, CatalogueModule, DocumentsModule, DocumentTemplatesModule],
  controllers: [
    StatutoryAuditController,
    AuditAcceptanceController,
    AuditAcceptanceFilesController,
    AuditAcceptanceSignoffController,
    AuditProfileController,
    AuthorityProvisionsController,
    AuditFinancialReportingController,
    AuditFrameworkEvidenceController,
    AuditFrameworkDownstreamController,
    AuditScheduleIiiController,
    AuditFsWorkbookController,
    AuditCaroController,
    AuditCaroProgrammeController,
    AuditIcfrController,
    AuditIcfrControlsController,
    AuditConsolidationController,
    AuditGroupAuditController,
    AuditReportingRecordsController,
    AuditOtherReportingController,
    AuditFrameworkSummaryController,
    AuditRollForwardController,
    AuditFrameworkController,
    AuditMattersController,
    AuditWorkController,
    AuditPlanningController,
    AuditPlanningIntelligenceController,
    AuditPlanningStrategyController,
    AuditBusinessUnderstandingController,
    AuditMaterialityController,
    AuditScopeApproachController,
    AuditAreaReviewController,
    AuditRiskController,
    AuditProcedureController,
    AuditPbcController,
    AuditReviewController,
    AuditTeamController,
    AuditCompletionController,
    AuditReassessmentController,
    AuditUndoController,
  ],
  providers: [
    // One change set per mutating request — the unit of audit-file undo.
    { provide: APP_INTERCEPTOR, useClass: ChangeSetInterceptor },
    AuditUndoService,
    StatutoryAuditWorkflowService,
    AuditAcceptanceService,
    AuditAcceptanceFilesService,
    AuditAcceptanceSignoffService,
    AuditProfileService,
    AuditFinancialReportingService,
    AuditFrameworkEvidenceService,
    AuditFrameworkDownstreamService,
    AuditScheduleIiiService,
    AuditFsWorkbookService,
    AuditCaroService,
    AuditCaroProgrammeService,
    AuditIcfrService,
    AuditIcfrControlsService,
    AuditConsolidationService,
    AuditGroupAuditService,
    AuditReportingRecordsService,
    AuditOtherReportingService,
    AuditFrameworkSummaryService,
    AuditRollForwardService,
    AuditFrameworkService,
    AuditMattersService,
    AuditWorkService,
    AuditPlanningService,
    AuditPlanningIntelligenceService,
    AuditPlanningStrategyService,
    AuditBusinessUnderstandingService,
    AuditMaterialityService,
    AuditScopeApproachService,
    AuditAreaReviewService,
    AuditRiskService,
    AuditProcedureService,
    AuditPbcService,
    AuditReviewService,
    AuditTeamService,
    AuditCompletionService,
    AuditReassessmentService,
  ],
  exports: [
    StatutoryAuditWorkflowService,
    AuditAcceptanceService,
    AuditProfileService,
    AuditFinancialReportingService,
    AuditScheduleIiiService,
    AuditCaroService,
    AuditCaroProgrammeService,
    AuditIcfrService,
    AuditIcfrControlsService,
    AuditConsolidationService,
    AuditGroupAuditService,
    AuditOtherReportingService,
    AuditFrameworkSummaryService,
    AuditRollForwardService,
    AuditFrameworkService,
    AuditMattersService,
    AuditWorkService,
    AuditPlanningService,
    AuditPlanningIntelligenceService,
    AuditPlanningStrategyService,
    AuditBusinessUnderstandingService,
    AuditMaterialityService,
    AuditRiskService,
    AuditProcedureService,
    AuditPbcService,
    AuditReviewService,
    AuditTeamService,
    AuditCompletionService,
    AuditReassessmentService,
  ],
})
export class StatutoryAuditModule {}
