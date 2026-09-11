import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentsListController } from './documents-list.controller';
import { OnlyOfficeController } from './onlyoffice/onlyoffice.controller';
import { OnlyOfficeService } from './onlyoffice/onlyoffice.service';
import { M365Service } from './m365/m365.service';
import { GraphClient } from './m365/graph-client';

/**
 * Documents (Phase 10). Engagement-scoped professional evidence: metadata +
 * versioned bytes. The bytes live behind a storage-provider abstraction (local
 * filesystem in dev/test, Azure Blob in production); PostgreSQL holds only
 * metadata. Access inherits the engagement (RLS), downloads are audited, and
 * version rows are append-only so evidence is never silently replaced.
 */
@Module({
  imports: [AuditModule, StorageModule, NotificationsModule],
  controllers: [DocumentsController, DocumentsListController, OnlyOfficeController],
  providers: [DocumentsService, OnlyOfficeService, M365Service, GraphClient],
  exports: [DocumentsService],
})
export class DocumentsModule {}
