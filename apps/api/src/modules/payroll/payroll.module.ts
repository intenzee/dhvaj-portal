import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CredentialCipher } from '../credentials/credential-cipher';
import { StorageModule } from '../documents/storage/storage.module';
import { PeopleModule } from '../people/people.module';
import { MyPayController } from './my-pay.controller';
import { MyTaxController } from './my-tax.controller';
import { PayrollExitsService } from './payroll-exits.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollTaxController } from './payroll-tax.controller';
import { PayrollTaxService } from './payroll-tax.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/**
 * Payroll core (spec §4.8, phase 2a): structures, the monthly run, bank file,
 * payslips, registers, the Accountant's totals and journal, statutory challans.
 * Phase 2b: declarations and proofs, TDS on salary, Forms 138 and 130, full
 * and final, statutory bonus.
 * Bank accounts and PANs are sealed with the credential key (ADR-0035).
 */
@Module({
  imports: [AuditModule, PeopleModule, StorageModule],
  controllers: [PayrollController, PayrollTaxController, MyPayController, MyTaxController],
  providers: [
    CredentialCipher,
    PayrollService,
    PayrollRunsService,
    PayrollTaxService,
    PayrollExitsService,
  ],
  exports: [PayrollService, PayrollRunsService],
})
export class PayrollModule {}
