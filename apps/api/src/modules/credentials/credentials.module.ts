import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitiesModule } from '../entities/entities.module';
import { CredentialCipher } from './credential-cipher';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { GstImportController } from './gst-import.controller';
import { GstImportService } from './gst-import.service';

/**
 * ADR-0035 — clients' portal logins, encrypted in the API and shown only on
 * request, and the GST client import that fills them from a spreadsheet.
 */
@Module({
  imports: [AuditModule, EntitiesModule],
  controllers: [CredentialsController, GstImportController],
  providers: [CredentialCipher, CredentialsService, GstImportService],
})
export class CredentialsModule {}
