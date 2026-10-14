import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURE_FLAG, PERMISSION, type SearchResponse } from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { SearchQueryDto } from './search.dto';
import { SearchService } from './search.service';

/**
 * Staff Workflow WF-304 — Ctrl K. Behind ff_filing_runs (404 when off for the
 * caller's office; the web falls back to its client / engagement search).
 */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Search clients, engagements, filings, tasks and documents (WF-304)',
    description:
      'Grouped hits, each with the exact place it opens (`href`, `link`). Forms and months in ' +
      'the query are understood: "bharat gstr1 sep" finds Bharat\'s GSTR-1 for Sep of the ' +
      'current financial year, and filings come first. Every group is RLS-scoped; clients ' +
      'need entity.read.',
  })
  find(
    @CurrentPrincipal() principal: Principal,
    @Query() query: SearchQueryDto,
  ): Promise<SearchResponse> {
    if (!this.flags.isOnFor(FEATURE_FLAG.filingRuns, principal.officeCode))
      throw new NotFoundException();
    return this.search.search(rlsContextFromPrincipal(principal), query.q, {
      clients: principal.permissions.includes(PERMISSION.entityRead),
    });
  }
}
