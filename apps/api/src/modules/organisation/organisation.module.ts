import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrganisationService } from './organisation.service';
import { EmployeesController } from './employees.controller';
import { PartnersController } from './partners.controller';

/**
 * Organisation & people: employees, grades, partner profiles and reporting
 * lines. Read endpoints are RLS-scoped; writes are audited.
 */
@Module({
  imports: [AuditModule],
  controllers: [EmployeesController, PartnersController],
  providers: [OrganisationService],
  exports: [OrganisationService],
})
export class OrganisationModule {}
