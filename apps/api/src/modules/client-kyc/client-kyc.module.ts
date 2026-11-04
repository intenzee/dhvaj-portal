import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClientKycController } from './client-kyc.controller';
import { ClientKycService } from './client-kyc.service';

/** Practice Services PS-404 — client KYC and its register. */
@Module({
  imports: [AuditModule],
  controllers: [ClientKycController],
  providers: [ClientKycService],
  exports: [ClientKycService],
})
export class ClientKycModule {}
