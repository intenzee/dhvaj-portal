import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Staff Workflow WF-304 — Ctrl K search across the work (GET /search). */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
