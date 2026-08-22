import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { DocumentsService } from './documents.service';
import type { GlobalDocumentRecord } from './documents.types';
import { DocumentListQueryDto } from './dto/document.dto';

/**
 * Cross-engagement documents view. Same visibility as the per-engagement list
 * (access inherits the engagement, enforced by RLS), flattened across every
 * engagement the caller can access, with engagement/client context.
 */
@ApiTags('documents')
@Controller('documents')
export class DocumentsListController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'List documents across all accessible engagements (paginated)',
    description:
      'RLS-scoped exactly like the per-engagement list. Filter by status/type/classification/search.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: DocumentListQueryDto,
  ): Promise<Paginated<GlobalDocumentRecord>> {
    const filter: {
      status?: DocumentListQueryDto['status'];
      documentType?: DocumentListQueryDto['documentType'];
      classification?: DocumentListQueryDto['classification'];
      search?: string;
    } = {};
    if (query.status) filter.status = query.status;
    if (query.documentType) filter.documentType = query.documentType;
    if (query.classification) filter.classification = query.classification;
    if (query.search) filter.search = query.search;
    const result = await this.documents.listAll(rlsContextFromPrincipal(principal), query, filter);
    return paginate(result, query);
  }
}
