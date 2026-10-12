import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ActivityPage } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { ActivityService } from './activity.service';
import { ActivityQueryDto } from './activity.dto';

/** Change 3 — Activity → Timeline. Members only (RLS on every source). */
@ApiTags('engagements')
@Controller('engagements')
export class EngagementActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get(':id/activity')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary:
      'One feed, newest first: status changes, filings, documents, client requests, comments, time',
    description:
      'Filter by stream / person / kind; `pinned=true` lists pinned comments. Cursor-paginated.',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityPage> {
    return this.activity.list(rlsContextFromPrincipal(principal), id, query);
  }
}
