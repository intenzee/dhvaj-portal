import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FeatureFlagsResponse } from '@hsdg/contracts';
import { CurrentPrincipal } from '../../modules/auth/auth.decorators';
import type { Principal } from '../../modules/auth/principal';
import { FeatureFlagsService } from './feature-flags.service';

/** Which phases are on — any signed-in user (the web and mobile app gate UI on it). */
@ApiTags('meta')
@Controller('meta')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get('features')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Feature flags for the caller',
    description: "FEATURE_FLAGS, narrowed to the caller's office by FEATURE_FLAG_OFFICES.",
  })
  features(@CurrentPrincipal() principal: Principal): FeatureFlagsResponse {
    return { flags: this.flags.all(principal.officeCode) };
  }
}
