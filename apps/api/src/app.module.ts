import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule } from 'nestjs-cls';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule, AppConfigService } from './config/config.module';
import { buildLoggerConfig } from './common/logging/logger.config';
import { clsOptions } from './common/context/request-context';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganisationModule } from './modules/organisation/organisation.module';
import { EntitiesModule } from './modules/entities/entities.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { EngagementsModule } from './modules/engagements/engagements.module';
import { ComponentsModule } from './modules/components/components.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { NotesModule } from './modules/notes/notes.module';

/**
 * Composition root of the modular monolith.
 *
 * Cross-cutting foundations (Phase 0):
 *   - AppConfigModule  — validated, typed configuration
 *   - ClsModule        — per-request async context (correlation id)
 *   - LoggerModule     — structured logging + correlation ids
 *   - ThrottlerModule  — request rate limiting
 *   - DatabaseModule   — least-privilege pool + RLS-context gateway
 *   - HealthModule     — liveness / readiness
 *
 * Identity & security (Phase 1):
 *   - AuditModule / IdentityModule / AuthModule
 *
 * Organisation & people (Phase 2):
 *   - OrganisationModule — employees, grades, partners, reporting lines
 *
 * Entity master (Phase 3):
 *   - EntitiesModule — client entities, registrations, contacts, duplicates
 *
 * Service catalogue (Phase 4):
 *   - CatalogueModule — review models, service lines, workflows, services
 *
 * Engagement core (Phase 5):
 *   - EngagementsModule — the central transactional object; assignment-based access
 *
 * Remaining domain modules (lifecycle, reviews, compliance, …) are added one
 * per phase and imported here as they land.
 */
@Module({
  imports: [
    AppConfigModule,
    ClsModule.forRoot(clsOptions),
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: buildLoggerConfig,
    }),
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        // Rate limit is effectively disabled under test to keep the suite
        // deterministic; real environments get a sane per-IP ceiling.
        throttlers: [{ ttl: 60_000, limit: config.isTest ? 1_000_000 : 100 }],
      }),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    AuditModule,
    IdentityModule,
    AuthModule,
    OrganisationModule,
    EntitiesModule,
    CatalogueModule,
    EngagementsModule,
    ComponentsModule,
    ComplianceModule,
    TasksModule,
    DocumentsModule,
    NotificationsModule,
    DashboardModule,
    ReportsModule,
    SchedulerModule,
    CommercialModule,
    NotesModule,
  ],
  providers: [
    // Rate limiting runs ahead of authentication/authorisation.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
