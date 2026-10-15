import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitiesModule } from '../entities/entities.module';
import { ClientImportController } from './client-import.controller';
import { ClientImportService } from './client-import.service';
import { CredentialCipher } from './credential-cipher';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

/**
 * ADR-0035 — clients' portal logins, encrypted in the API and shown only on
 * request, and the client import that fills them from the firm's workbook.
 */
@Module({
  imports: [AuditModule, EntitiesModule],
  controllers: [CredentialsController, ClientImportController],
  providers: [CredentialCipher, CredentialsService, ClientImportService],
})
export class CredentialsModule {}
