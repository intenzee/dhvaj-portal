import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type TaxAuditLibraryView } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  CreateTaxAuditLibraryDraftDto,
  TaxAuditLibraryClauseDto,
  UpdateTaxAuditLibraryDraftDto,
} from './dto/tax-audit-clause-library.dto';
import { TaxAuditClauseLibraryService } from './tax-audit-clause-library.service';

/**
 * Form 3CD clause library (Phase 4, F-4). Every member of staff reads it;
 * Admin and the Managing Partner (service.manage) change it on one draft and
 * publish it as the next, immutable version.
 */
@ApiTags('tax-audit-clause-library')
@Controller('tax-audit-clause-library')
export class TaxAuditClauseLibraryController {
  constructor(private readonly library: TaxAuditClauseLibraryService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary:
      'The library versions and the clauses of one (asked for, else the draft, else the newest)',
  })
  view(
    @CurrentPrincipal() p: Principal,
    @Query('version', new ParseIntPipe({ optional: true })) version?: number,
  ): Promise<TaxAuditLibraryView> {
    return this.library.view(rlsContextFromPrincipal(p), version);
  }

  @Post('drafts')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({
    summary: 'Start the next version: a copy of a published one, or a whole version as data',
    description:
      'With `clauses`, the version is loaded from them (a new form, without a code change); otherwise it copies `basedOnVersionNo`, or the newest published version.',
  })
  createDraft(
    @CurrentPrincipal() p: Principal,
    @Body() dto: CreateTaxAuditLibraryDraftDto,
  ): Promise<TaxAuditLibraryView> {
    return this.library.createDraft(rlsContextFromPrincipal(p), dto);
  }

  @Patch(':version')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: "Change the draft's name, Act, first year or notes" })
  updateDraft(
    @CurrentPrincipal() p: Principal,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: UpdateTaxAuditLibraryDraftDto,
  ): Promise<TaxAuditLibraryView> {
    return this.library.updateDraft(rlsContextFromPrincipal(p), version, dto);
  }

  @Post(':version/clauses')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Add a clause to the draft' })
  addClause(
    @CurrentPrincipal() p: Principal,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: TaxAuditLibraryClauseDto,
  ): Promise<TaxAuditLibraryView> {
    return this.library.upsertClause(rlsContextFromPrincipal(p), version, null, dto);
  }

  @Put(':version/clauses/:clauseId')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Change a clause of the draft' })
  updateClause(
    @CurrentPrincipal() p: Principal,
    @Param('version', ParseIntPipe) version: number,
    @Param('clauseId', new ParseUUIDPipe()) clauseId: string,
    @Body() dto: TaxAuditLibraryClauseDto,
  ): Promise<TaxAuditLibraryView> {
    return this.library.upsertClause(rlsContextFromPrincipal(p), version, clauseId, dto);
  }

  @Delete(':version/clauses/:clauseId')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Take a clause off the draft' })
  removeClause(
    @CurrentPrincipal() p: Principal,
    @Param('version', ParseIntPipe) version: number,
    @Param('clauseId', new ParseUUIDPipe()) clauseId: string,
  ): Promise<TaxAuditLibraryView> {
    return this.library.removeClause(rlsContextFromPrincipal(p), version, clauseId);
  }

  @Post(':version/publish')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Publish the draft: it becomes an immutable version' })
  publish(
    @CurrentPrincipal() p: Principal,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<TaxAuditLibraryView> {
    return this.library.publish(rlsContextFromPrincipal(p), version);
  }

  @Delete(':version')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Discard the draft' })
  discardDraft(
    @CurrentPrincipal() p: Principal,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<TaxAuditLibraryView> {
    return this.library.discardDraft(rlsContextFromPrincipal(p), version);
  }
}
