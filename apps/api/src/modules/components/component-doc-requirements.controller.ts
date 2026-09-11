import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ComponentDocChecklistItem,
  type ServiceComponentDocRequirementRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ComponentDocRequirementsService } from './component-doc-requirements.service';
import {
  CreateComponentDocRequirementDto,
  UpdateComponentDocRequirementDto,
} from './dto/component-doc-requirement.dto';

/**
 * Required-documents checklist (feature: "what's missing").
 *   • Catalogue CRUD (service.read / service.manage) under a service component.
 *   • Per-period checklist status (engagement.read) for a component-work item.
 */
@ApiTags('component-doc-requirements')
@Controller()
export class ComponentDocRequirementsController {
  constructor(private readonly requirements: ComponentDocRequirementsService) {}

  @Get('service-components/:componentId/doc-requirements')
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'List the required-document checklist for a service component.' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('componentId', new ParseUUIDPipe()) componentId: string,
  ): Promise<ServiceComponentDocRequirementRecord[]> {
    return this.requirements.list(rlsContextFromPrincipal(principal), componentId);
  }

  @Post('service-components/:componentId/doc-requirements')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Add a required document to a service component (audited).' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('componentId', new ParseUUIDPipe()) componentId: string,
    @Body() dto: CreateComponentDocRequirementDto,
  ): Promise<ServiceComponentDocRequirementRecord> {
    return this.requirements.create(rlsContextFromPrincipal(principal), componentId, dto);
  }

  @Patch('doc-requirements/:id')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Update a checklist requirement (audited).' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateComponentDocRequirementDto,
  ): Promise<ServiceComponentDocRequirementRecord> {
    return this.requirements.update(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete('doc-requirements/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Remove a checklist requirement (tagged documents are retained).' })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.requirements.remove(rlsContextFromPrincipal(principal), id);
  }

  @Get('engagements/:id/component-work/:instanceId/checklist')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Required-documents checklist status for one component-work period.' })
  checklist(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('instanceId', new ParseUUIDPipe()) instanceId: string,
  ): Promise<ComponentDocChecklistItem[]> {
    return this.requirements.checklistForInstance(
      rlsContextFromPrincipal(principal),
      id,
      instanceId,
    );
  }
}
