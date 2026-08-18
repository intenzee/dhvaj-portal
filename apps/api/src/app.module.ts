import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule, AppConfigService } from './config/config.module';
import { buildLoggerConfig } from './common/logging/logger.config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';

/**
 * Composition root of the modular monolith.
 *
 * Phase 0 wires only cross-cutting foundations:
 *   - AppConfigModule  — validated, typed configuration
 *   - LoggerModule     — structured logging + correlation ids
 *   - DatabaseModule   — least-privilege pool + RLS-context gateway
 *   - HealthModule     — liveness / readiness
 *
 * Phase 1 adds the identity & security modules:
 *   - AuditModule      — append-only audit trail
 *   - IdentityModule   — users, offices, roles/permissions
 *   - AuthModule       — authentication, global guards, authorisation
 *
 * Remaining domain modules (organisation, entities, services, engagements, …)
 * are added one per phase and imported here as they land.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: buildLoggerConfig,
    }),
    DatabaseModule,
    HealthModule,
    AuditModule,
    IdentityModule,
    AuthModule,
  ],
})
export class AppModule {}
