import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { CatalogueTemplatesService } from './catalogue-templates.service';
import type {
  CatalogueTemplateDetail,
  CatalogueTemplateRecord,
  CatalogueTemplateVersionRecord,
  TemplateFilter,
} from './catalogue.types';
import { CreateTemplateDto } from './dto/create-template.dto';
import { AddTemplateVersionDto } from './dto/add-template-version.dto';
import { TemplateListQueryDto } from './dto/template-list-query.dto';

/**
 * Reusable, versioned checklist / PBC / document-requirement templates
 * (§18/§25/§27). Firm-wide config: read by all, managed by MP/admin. Versions
 * are append-only.
 */
@ApiTags('catalogue-templates')
@Controller('catalogue-templates')
export class CatalogueTemplatesController {
  constructor(private readonly templates: CatalogueTemplatesService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'List catalogue templates (paginated; filter by type/active/search)' })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: TemplateListQueryDto,
  ): Promise<Paginated<CatalogueTemplateRecord>> {
    const filter: TemplateFilter = {};
    if (query.templateType) filter.templateType = query.templateType;
    if (query.active !== undefined) filter.active = query.active;
    if (query.search) filter.search = query.search;
    const result = await this.templates.listTemplates(
      rlsContextFromPrincipal(principal),
      filter,
      query,
    );
    return paginate(result, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.serviceRead)
  @ApiOperation({ summary: 'Get a template with its effective-dated versions' })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CatalogueTemplateDetail> {
    const template = await this.templates.getTemplateById(rlsContextFromPrincipal(principal), id);
    if (!template) throw new NotFoundException('Template not found.');
    return template;
  }

  @Post()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Create a template (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateTemplateDto,
  ): Promise<CatalogueTemplateRecord> {
    return this.templates.createTemplate(rlsContextFromPrincipal(principal), dto);
  }

  @Post(':id/versions')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append an effective-dated template version (audited; append-only)' })
  addVersion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddTemplateVersionDto,
  ): Promise<CatalogueTemplateVersionRecord> {
    return this.templates.addVersion(rlsContextFromPrincipal(principal), id, dto);
  }
}
