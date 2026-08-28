import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';

/**
 * Engagement Notes (spec §26): a shared, engagement-scoped notebook. RLS
 * (members read/add, author-or-lead edit/remove) governs access, so no
 * dependency on EngagementsModule.
 */
@Module({
  imports: [AuditModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
