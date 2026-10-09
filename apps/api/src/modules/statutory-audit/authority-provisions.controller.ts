import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AuthorityProvisionRecord,
  type AuthorityReference,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { UpdateAuthorityProvisionDto } from './dto/profile.dto';

/**
 * The Authority / Provision Library behind every `View Provision / View
 * Standard / View Guidance` action (spec 02.1 §3, §19). Resolution is BY DATE —
 * a historical engagement opens the version in force for its period. The
 * viewer content (summary, source link) is maintained centrally here, so a link
 * changes without touching workflow code.
 */
@ApiTags('authority')
@Controller('authority-provisions')
export class AuthorityProvisionsController {
  constructor(
    private readonly rules: AuditRulesService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('references/:contextKey')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "A workflow context's View Provision links, resolved for a date",
    description:
      'The configured links of the context (e.g. 02.2) in the version in force on `on`, ' +
      'then each provision version a conclusion cited (`cited`, comma-separated ids).',
  })
  async references(
    @CurrentPrincipal() principal: Principal,
    @Param('contextKey') contextKey: string,
    @Query('on') on?: string,
    @Query('cited') cited?: string,
  ): Promise<AuthorityReference[]> {
    if (!/^[0-9]{2}(\.[0-9]{1,2})?$/.test(contextKey)) {
      throw new BadRequestException('Unknown reference context.');
    }
    const date = on ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException('`on` must be YYYY-MM-DD.');
    const ids = (cited ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (ids.length > 20 || ids.some((id) => !uuid.test(id))) {
      throw new BadRequestException('`cited` must be up to 20 provision ids.');
    }
    return this.db.withRlsContext(rlsContextFromPrincipal(principal), (client) =>
      this.rules.resolveReferencesWithCitedOn(client, contextKey, date, ids),
    );
  }

  @Get(':code')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The provision / standard in force on a date (default: today)' })
  async resolve(
    @CurrentPrincipal() principal: Principal,
    @Param('code') code: string,
    @Query('on') on?: string,
  ): Promise<AuthorityProvisionRecord> {
    if (!/^[A-Z0-9_]{2,60}$/.test(code)) throw new BadRequestException('Unknown provision code.');
    const date = on ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException('`on` must be YYYY-MM-DD.');
    const found = await this.rules.resolveProvision(rlsContextFromPrincipal(principal), code, date);
    if (!found)
      throw new NotFoundException('No version of that provision is in force on that date.');
    return found;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({
    summary: "Maintain a provision's viewer content (summary, MCA/ICAI source link)",
    description:
      'Citation identity (code, number, dates) never changes in place — supersede instead.',
  })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAuthorityProvisionDto,
  ): Promise<AuthorityProvisionRecord> {
    const ctx = rlsContextFromPrincipal(principal);
    return this.db.withRlsContext(ctx, async (client) => {
      const updated = await this.rules.updateProvisionContent(client, id, dto);
      if (!updated) throw new NotFoundException('Provision not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'authority.provision_content_updated',
        objectType: 'authority_provision',
        objectId: id,
        after: { summary: dto.summary, sourceUrl: dto.sourceUrl },
      });
      return updated;
    });
  }
}
