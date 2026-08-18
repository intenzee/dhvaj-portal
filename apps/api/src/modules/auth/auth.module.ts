import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigService } from '../../config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { AuditModule } from '../audit/audit.module';
import { ACTIVE_AUTH_PROVIDER } from './authentication-provider';
import { DevAuthProvider } from './dev-auth.provider';
import { EntraAuthProvider } from './entra-auth.provider';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { AuthController } from './auth.controller';

/**
 * Authentication & authorisation.
 *
 * Registers both identity providers and selects the active one by config; wires
 * the global guards in order — authentication first, then permissions — so every
 * route is protected unless explicitly {@link Public}.
 */
@Module({
  imports: [IdentityModule, AuditModule],
  controllers: [AuthController],
  providers: [
    DevAuthProvider,
    EntraAuthProvider,
    {
      provide: ACTIVE_AUTH_PROVIDER,
      inject: [AppConfigService, DevAuthProvider, EntraAuthProvider],
      useFactory: (config: AppConfigService, dev: DevAuthProvider, entra: EntraAuthProvider) =>
        config.get('AUTH_PROVIDER') === 'entra' ? entra : dev,
    },
    AuthService,
    // Global guards. Order is significant: authenticate, then authorise.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
