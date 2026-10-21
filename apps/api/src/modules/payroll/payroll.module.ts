import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CredentialCipher } from '../credentials/credential-cipher';
import { MyPayController } from './my-pay.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/**
 * Payroll core (spec §4.8, phase 2a): structures, the monthly run, bank file,
 * payslips, registers, the Accountant's totals and journal, statutory challans.
 * Bank accounts and PANs are sealed with the credential key (ADR-0035).
 */
@Module({
  imports: [AuditModule],
  controllers: [PayrollController, MyPayController],
  providers: [CredentialCipher, PayrollService, PayrollRunsService],
  exports: [PayrollService, PayrollRunsService],
})
export class PayrollModule {}
