import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityService } from './identity.service';
import { UsersController } from './users.controller';
import { OfficesController } from './offices.controller';
import { RolesController } from './roles.controller';

/**
 * Identity data domain: users, offices, roles/permissions resolution. Exposes
 * RLS-scoped read endpoints and audited write endpoints (Administration), plus
 * the {@link IdentityService} consumed by auth.
 */
@Module({
  imports: [AuditModule],
  controllers: [UsersController, OfficesController, RolesController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
