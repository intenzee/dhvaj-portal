import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';

/**
 * Documents (Phase 10). Engagement-scoped professional evidence: metadata +
 * versioned bytes. The bytes live behind a storage-provider abstraction (local
 * filesystem in dev/test, Azure Blob in production); PostgreSQL holds only
 * metadata. Access inherits the engagement (RLS), downloads are audited, and
 * version rows are append-only so evidence is never silently replaced.
 */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
