import { Module } from '@nestjs/common';
import { NoticeIntakeController } from './notice-intake.controller';
import { NoticeIntakeService } from './notice-intake.service';

/**
 * PS-104 · notice intake from the PDF: reads an uploaded notice's OCR text,
 * suggests the "Add notice" form's fields (notices/notice-extract.ts) and the
 * client it is for. Read-only — the notice is created by POST /notices.
 * Behind ff_notices; RLS decides which documents and clients the caller sees.
 */
@Module({
  controllers: [NoticeIntakeController],
  providers: [NoticeIntakeService],
})
export class NoticeIntakeModule {}
