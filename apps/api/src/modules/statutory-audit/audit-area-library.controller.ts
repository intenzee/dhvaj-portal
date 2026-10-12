import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type AuditAreaLibraryAdminView } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditAreaLibraryService } from './audit-area-library';
import { CreateLibraryDraftDto, UpsertLibraryAreaDto } from './dto/area-library.dto';

/**
 * Audit Area Library administration (DHVAJ 03.5 §4, §6, §7). A released
 * version is immutable; changes are made on one draft cloned from the current
 * release and published as the next version. Methodology only — no client data.
 */
@ApiTags('audit-area-library')
@Controller('audit-area-library')
export class AuditAreaLibraryController {
  constructor(private readonly library: AuditAreaLibraryService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Library releases and the areas of one (draft, else current)' })
  view(
    @CurrentPrincipal() p: Principal,
    @Query('version') version?: string,
  ): Promise<AuditAreaLibraryAdminView> {
    return this.library.view(rlsContextFromPrincipal(p), version || undefined);
  }

  @Post('drafts')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Start the next library version as a draft copy of the current one' })
  createDraft(
    @CurrentPrincipal() p: Principal,
    @Body() dto: CreateLibraryDraftDto,
  ): Promise<AuditAreaLibraryAdminView> {
    return this.library.createDraft(rlsContextFromPrincipal(p), dto);
  }

  @Post(':version/areas')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Add an Audit Area to the draft' })
  addArea(
    @CurrentPrincipal() p: Principal,
    @Param('version') version: string,
    @Body() dto: UpsertLibraryAreaDto,
  ): Promise<AuditAreaLibraryAdminView> {
    return this.library.upsertArea(rlsContextFromPrincipal(p), version, null, dto);
  }

  @Post(':version/areas/:areaId')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Change (or deactivate) an Audit Area of the draft' })
  updateArea(
    @CurrentPrincipal() p: Principal,
    @Param('version') version: string,
    @Param('areaId', new ParseUUIDPipe()) areaId: string,
    @Body() dto: UpsertLibraryAreaDto,
  ): Promise<AuditAreaLibraryAdminView> {
    return this.library.upsertArea(rlsContextFromPrincipal(p), version, areaId, dto);
  }

  @Post(':version/publish')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Publish the draft — it becomes the current, immutable release' })
  publish(
    @CurrentPrincipal() p: Principal,
    @Param('version') version: string,
  ): Promise<AuditAreaLibraryAdminView> {
    return this.library.publish(rlsContextFromPrincipal(p), version);
  }
}
