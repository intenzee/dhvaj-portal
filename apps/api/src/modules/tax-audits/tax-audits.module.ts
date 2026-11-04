import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { DocumentTemplatesModule } from '../document-templates/document-templates.module';
import { DocumentsModule } from '../documents/documents.module';
import { TaxAuditAcceptanceService } from './tax-audit-acceptance.service';
import { TaxAuditClauseLibraryController } from './tax-audit-clause-library.controller';
import { TaxAuditClauseLibraryService } from './tax-audit-clause-library.service';
import { TaxAuditApplicabilityService } from './tax-audit-applicability.service';
import { TaxAuditsController } from './tax-audits.controller';
import { TaxAuditsService } from './tax-audits.service';
import { TaxAuditWorkspaceController } from './tax-audit-workspace.controller';
import { TaxAuditWorkspaceService } from './tax-audit-workspace.service';

/**
 * Tax Audit (Phases 3–5): the yearly audits, applicability and the radar,
 * acceptance, the Form 3CD clause library and the clause workspace.
 */
@Module({
  imports: [AuditModule, ComplianceModule, DocumentsModule, DocumentTemplatesModule],
  controllers: [TaxAuditsController, TaxAuditClauseLibraryController, TaxAuditWorkspaceController],
  providers: [
    TaxAuditsService,
    TaxAuditApplicabilityService,
    TaxAuditAcceptanceService,
    TaxAuditClauseLibraryService,
    TaxAuditWorkspaceService,
  ],
})
export class TaxAuditsModule {}
