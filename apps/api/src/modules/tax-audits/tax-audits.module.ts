import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { TaxAuditApplicabilityService } from './tax-audit-applicability.service';
import { TaxAuditsController } from './tax-audits.controller';
import { TaxAuditsService } from './tax-audits.service';

/** Tax Audit (Phase 3, F-1/F-2): the yearly audits, applicability and the radar. */
@Module({
  imports: [AuditModule, ComplianceModule],
  controllers: [TaxAuditsController],
  providers: [TaxAuditsService, TaxAuditApplicabilityService],
})
export class TaxAuditsModule {}
