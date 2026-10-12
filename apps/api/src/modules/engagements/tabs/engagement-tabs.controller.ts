import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type EngagementTabs } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { EngagementTabsService } from './engagement-tabs.service';

/** Change 3 — tab layout + Overview widgets for the engagement page. */
@ApiTags('engagements')
@Controller('engagements')
export class EngagementTabsController {
  constructor(private readonly tabs: EngagementTabsService) {}

  @Get(':id/tabs')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Kind, years and stream tabs in scope (with leads), and the Overview widgets',
  })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EngagementTabs> {
    return this.tabs.get(rlsContextFromPrincipal(principal), id);
  }
}
