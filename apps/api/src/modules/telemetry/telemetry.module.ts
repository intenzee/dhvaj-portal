import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

/** Staff Workflow · How we measure it — POST /telemetry and the measures report. */
@Module({
  imports: [AuditModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
})
export class TelemetryModule {}
