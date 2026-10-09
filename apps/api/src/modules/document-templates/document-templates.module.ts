import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../documents/storage/storage.module';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentTemplatesController } from './document-templates.controller';

/**
 * Firm document templates (Section 01 spec §2, §10.2): the approved DHVAJ Word
 * files "Create from Template" merges engagement data into, their variants and
 * append-only versions, plus the firm details they merge in.
 */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
