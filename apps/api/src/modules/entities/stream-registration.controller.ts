import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { EntitiesService } from './entities.service';
import type { EntityDetail } from './entities.types';
import { StreamRegistrationDto, StreamRegistrationParamDto } from './dto/stream-registration.dto';

/**
 * "GSTIN missing" on a GST tab, "TAN missing" on a TDS tab: the engagement's
 * leads enter the client's GSTIN / TAN where they work, without the client
 * page (which needs entity.manage).
 */
@ApiTags('entities')
@Controller('engagements')
export class StreamRegistrationController {
  constructor(private readonly entities: EntitiesService) {}

  @Post(':id/streams/:stream/registration')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary:
      'Add the GSTIN / TAN a GST / TDS stream is waiting on (engagement lead or client manager)',
  })
  addRegistration(
    @CurrentPrincipal() principal: Principal,
    @Param() params: StreamRegistrationParamDto,
    @Body() dto: StreamRegistrationDto,
  ): Promise<EntityDetail> {
    return this.entities.addStreamRegistration(
      rlsContextFromPrincipal(principal),
      params.id,
      params.stream,
      dto,
      principal.permissions.includes(PERMISSION.entityManage),
    );
  }
}
