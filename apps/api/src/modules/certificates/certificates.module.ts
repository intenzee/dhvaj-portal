import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

/** Practice Services PS-402 — the certificates desk and register. */
@Module({
  imports: [AuditModule, DocumentsModule, NotificationsModule],
  controllers: [CertificatesController],
  providers: [CertificatesService],
})
export class CertificatesModule {}
