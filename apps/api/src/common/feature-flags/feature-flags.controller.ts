import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FeatureFlagsResponse } from '@hsdg/contracts';
import { FeatureFlagsService } from './feature-flags.service';

/** Which phases are on — any signed-in user (the web and mobile app gate UI on it). */
@ApiTags('meta')
@Controller('meta')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get('features')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Feature flags for the Engagement Restructure phases' })
  features(): FeatureFlagsResponse {
    return { flags: this.flags.all() };
  }
}
