import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StatutoryAuditWorkflowService } from './statutory-audit-workflow.service';
import { StatutoryAuditController } from './statutory-audit.controller';
import { AuditFrameworkService } from './audit-framework.service';
import { AuditFrameworkController } from './audit-framework.controller';
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
  imports: [AuditModule],
  controllers: [
    StatutoryAuditController,
    AuditFrameworkController,
    AuditWorkController,
    AuditPlanningController,
    AuditRiskController,
    AuditProcedureController,
    AuditPbcController,
  ],
  providers: [
    StatutoryAuditWorkflowService,
    AuditFrameworkService,
    AuditWorkService,
    AuditPlanningService,
    AuditRiskService,
    AuditProcedureService,
    AuditPbcService,
  ],
  exports: [
    StatutoryAuditWorkflowService,
    AuditFrameworkService,
    AuditWorkService,
    AuditPlanningService,
    AuditRiskService,
    AuditProcedureService,
    AuditPbcService,
  ],
})
export class StatutoryAuditModule {}
