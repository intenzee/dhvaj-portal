import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type RollHorizonResult } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ComponentInstancesService } from './component-instances.service';
import { RollHorizonDto } from './dto/roll-horizon.dto';

/**
 * Rolling recurring-work horizon (spec §18). Recurring component work is
 * materialised only for periods within the configured future horizon; a
 * scheduled worker (authenticated as the firm-wide operator) POSTs here to roll
 * it forward as time advances — idempotently, never duplicating. Reads need
 * `engagement.read`; the sweep needs `engagement.manage` and is RLS-scoped to
 * the engagements the caller can lead (the firm-wide operator covers the firm).
 */
@ApiTags('engagement-compliance')
@Controller('compliance/horizon')
export class ComplianceHorizonController {
  constructor(private readonly instances: ComponentInstancesService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Show the configured recurring-work future horizon (§18)' })
  horizon(): { horizonMonths: number } {
    return { horizonMonths: this.instances.configuredHorizonMonths() };
  }

  @Post()
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Roll the recurring-work horizon forward (§18; audited)',
    description:
      'Generates the recurring component work now within the horizon across every engagement the ' +
      'caller can lead. Idempotent — re-running fills periods newly in range without duplicating. ' +
      'Optionally override the horizon months or scope to a single engagement.',
  })
  roll(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: RollHorizonDto,
  ): Promise<RollHorizonResult> {
    const opts: { horizonMonths?: number; engagementId?: string } = {};
    if (dto.horizonMonths !== undefined) opts.horizonMonths = dto.horizonMonths;
    if (dto.engagementId) opts.engagementId = dto.engagementId;
    return this.instances.rollHorizon(rlsContextFromPrincipal(principal), opts);
  }
}
