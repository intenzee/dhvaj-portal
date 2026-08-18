import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CatalogueService } from './catalogue.service';
import type { ReviewModelRecord, WorkflowFamilyRecord } from './catalogue.types';

@ApiTags('review-models')
@Controller('review-models')
export class ReviewModelsController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'List review models (ranked by rigour)' })
  list(@CurrentPrincipal() principal: Principal): Promise<ReviewModelRecord[]> {
    return this.catalogue.listReviewModels(rlsContextFromPrincipal(principal));
  }
}

@ApiTags('workflow-families')
@Controller('workflow-families')
export class WorkflowFamiliesController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'List workflow families with their ordered states' })
  list(@CurrentPrincipal() principal: Principal): Promise<WorkflowFamilyRecord[]> {
    return this.catalogue.listWorkflowFamilies(rlsContextFromPrincipal(principal));
  }
}
