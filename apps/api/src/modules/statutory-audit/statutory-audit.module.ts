import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { StatutoryAuditWorkflowService } from './statutory-audit-workflow.service';
import { StatutoryAuditController } from './statutory-audit.controller';
import { AuditAcceptanceService } from './audit-acceptance.service';
import { AuditAcceptanceController } from './audit-acceptance.controller';
import { AuditProfileService } from './audit-profile.service';
import { AuditProfileController } from './audit-profile.controller';
import { AuditFinancialReportingService } from './audit-financial-reporting.service';
import { AuditFinancialReportingController } from './audit-financial-reporting.controller';
import { AuditScheduleIiiService } from './audit-schedule-iii.service';
import { AuditScheduleIiiController } from './audit-schedule-iii.controller';
import { AuditCaroService } from './audit-caro.service';
import { AuditCaroController } from './audit-caro.controller';
import { AuditIcfrService } from './audit-icfr.service';
import { AuditIcfrController } from './audit-icfr.controller';
import { AuditConsolidationService } from './audit-consolidation.service';
import { AuditConsolidationController } from './audit-consolidation.controller';
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
  imports: [AuditModule, CatalogueModule],
  controllers: [
    StatutoryAuditController,
    AuditAcceptanceController,
    AuditProfileController,
    AuditFinancialReportingController,
    AuditScheduleIiiController,
    AuditCaroController,
    AuditIcfrController,
    AuditConsolidationController,
    AuditOtherReportingController,
    AuditFrameworkSummaryController,
    AuditRollForwardController,
    AuditFrameworkController,
    AuditMattersController,
    AuditWorkController,
    AuditPlanningController,
    AuditRiskController,
    AuditProcedureController,
    AuditPbcController,
    AuditReviewController,
    AuditTeamController,
    AuditCompletionController,
    AuditReassessmentController,
  ],
  providers: [
    StatutoryAuditWorkflowService,
    AuditAcceptanceService,
    AuditProfileService,
    AuditFinancialReportingService,
    AuditScheduleIiiService,
    AuditCaroService,
    AuditIcfrService,
    AuditConsolidationService,
    AuditOtherReportingService,
    AuditFrameworkSummaryService,
    AuditRollForwardService,
    AuditFrameworkService,
    AuditMattersService,
    AuditWorkService,
    AuditPlanningService,
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
    AuditIcfrService,
    AuditConsolidationService,
    AuditOtherReportingService,
    AuditFrameworkSummaryService,
    AuditRollForwardService,
    AuditFrameworkService,
    AuditMattersService,
    AuditWorkService,
    AuditPlanningService,
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
