import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { EntitiesService } from './entities.service';
import type { EntityTypeRecord } from './entities.types';

@ApiTags('entity-types')
@Controller('entity-types')
export class EntityTypesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: 'List entity types (reference data)' })
  list(@CurrentPrincipal() principal: Principal): Promise<EntityTypeRecord[]> {
    return this.entities.listEntityTypes(rlsContextFromPrincipal(principal));
  }
}
