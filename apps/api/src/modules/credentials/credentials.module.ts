import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { EntitiesModule } from '../entities/entities.module';
import { ClientImportController } from './client-import.controller';
import { ClientImportService } from './client-import.service';
import { ClientMasterController } from './client-master.controller';
import { ClientMasterService } from './client-master.service';
import { ClientReturnsController } from './client-returns.controller';
import { ClientReturnsService } from './client-returns.service';
import { CredentialCipher } from './credential-cipher';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

/**
 * ADR-0035 — clients' portal logins, encrypted in the API and shown only on
 * request, the client import that fills them from the firm's workbook, and
 * the GST return history that workbook marks.
 */
@Module({
  imports: [AuditModule, EntitiesModule, EngagementsModule],
  controllers: [
    CredentialsController,
    ClientImportController,
    ClientMasterController,
    ClientReturnsController,
  ],
  providers: [
    CredentialCipher,
    CredentialsService,
    ClientImportService,
    ClientMasterService,
    ClientReturnsService,
  ],
})
export class CredentialsModule {}
