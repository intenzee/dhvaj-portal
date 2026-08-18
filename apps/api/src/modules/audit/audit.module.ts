import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

/**
 * Audit foundation. Provides the append-only {@link AuditService} used across
 * the app to record material events, and a read endpoint for firm-wide roles.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
