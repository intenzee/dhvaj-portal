import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UdinRegisterController } from './udin-register.controller';
import { UdinRegisterService } from './udin-register.service';

/** Practice Services Phase 3 — the firm's registers: UDIN (PS-304) and DSC (PS-305). */
@Module({
  imports: [AuditModule],
  controllers: [UdinRegisterController],
  providers: [UdinRegisterService],
  exports: [UdinRegisterService],
})
export class RegistersModule {}
