import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { UdinRegisterController } from './udin-register.controller';
import { UdinRegisterService } from './udin-register.service';
import { DscRegisterController } from './dsc-register.controller';
import { DscRegisterService } from './dsc-register.service';

/** Practice Services Phase 3 — the firm's registers: UDIN (PS-304) and DSC (PS-305). */
@Module({
  imports: [AuditModule, CredentialsModule],
  controllers: [UdinRegisterController, DscRegisterController],
  providers: [UdinRegisterService, DscRegisterService],
  exports: [UdinRegisterService, DscRegisterService],
})
export class RegistersModule {}
