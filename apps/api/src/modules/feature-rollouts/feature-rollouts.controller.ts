import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type FeatureRollout, type FeatureRolloutList } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { UpdateFeatureRolloutDto } from './feature-rollouts.dto';
import { FeatureRolloutsService } from './feature-rollouts.service';

/** Staff Workflow · Rollout (Admin → Rollout): each phase, office by office. */
@ApiTags('feature-rollouts')
@Controller('feature-rollouts')
export class FeatureRolloutsController {
  constructor(private readonly rollouts: FeatureRolloutsService) {}

  @Get()
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Every phase flag: deployed or not, and where it is on',
    description: "The deploy's FEATURE_FLAGS is the master switch; the firm chooses within it.",
  })
  list(@CurrentPrincipal() principal: Principal): Promise<FeatureRolloutList> {
    return this.rollouts.list(rlsContextFromPrincipal(principal));
  }

  @Put(':flag')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Turn a phase on for every office, pilot offices, or pause it (audited)',
  })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('flag') flag: string,
    @Body() dto: UpdateFeatureRolloutDto,
  ): Promise<FeatureRollout> {
    return this.rollouts.update(rlsContextFromPrincipal(principal), flag, dto);
  }

  @Delete(':flag')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({ summary: "Go back to the deploy's own setting for a phase (audited)" })
  reset(
    @CurrentPrincipal() principal: Principal,
    @Param('flag') flag: string,
  ): Promise<FeatureRollout> {
    return this.rollouts.reset(rlsContextFromPrincipal(principal), flag);
  }
}
