import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { UsersController } from './users.controller';
import { OfficesController } from './offices.controller';

/**
 * Identity data domain: users, offices, roles/permissions resolution. Exposes
 * read endpoints (RLS-scoped) and the {@link IdentityService} consumed by auth.
 */
@Module({
  controllers: [UsersController, OfficesController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
