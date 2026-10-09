import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type AuditRuleProvisionOption, type AuditRuleRecord } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditRulesAdminService } from './audit-rules-admin.service';
import { AddAuditRuleVersionDto } from './dto/audit-rules.dto';

/**
 * Rules Library administration (DHVAJ 02.2 spec §2): thresholds, effective
 * dates, exemptions and authoritative links are configuration data, maintained
 * here by the Managing Partner / administrator — no code deployment. Every
 * change is an appended, audited version; history is never rewritten.
 */
@ApiTags('audit-rules')
@Controller('audit-rules')
export class AuditRulesController {
  constructor(
    private readonly admin: AuditRulesAdminService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Every audit rule with its dated version history' })
  list(@CurrentPrincipal() principal: Principal): Promise<AuditRuleRecord[]> {
    return this.db.withRlsContext(rlsContextFromPrincipal(principal), (client) =>
      this.admin.listOn(client),
    );
  }

  @Get('provisions')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Provisions a rule version can cite' })
  provisions(@CurrentPrincipal() principal: Principal): Promise<AuditRuleProvisionOption[]> {
    return this.db.withRlsContext(rlsContextFromPrincipal(principal), async (client) => {
      const { rows } = await client.query<{
        id: string;
        code: string;
        title: string;
        provision_number: string;
        effective_from: string;
        effective_to: string | null;
      }>(
        `SELECT id, code, title, provision_number, effective_from::text, effective_to::text
           FROM hsdg.authority_provision
          ORDER BY code, effective_from DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        provisionNumber: r.provision_number,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
      }));
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'One audit rule with its version history' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AuditRuleRecord> {
    const rule = await this.db.withRlsContext(rlsContextFromPrincipal(principal), (client) =>
      this.admin.getOn(client, id),
    );
    if (!rule) throw new NotFoundException('Rule not found.');
    return rule;
  }

  @Post(':id/versions')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({
    summary: 'Append a dated version (new threshold / effective date / condition / provision)',
    description:
      'Periods starting before `effectiveFrom` keep resolving to the earlier version; ' +
      'concluded engagements are never altered.',
  })
  addVersion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddAuditRuleVersionDto,
  ): Promise<AuditRuleRecord> {
    const ctx = rlsContextFromPrincipal(principal);
    return this.db.withRlsContext(ctx, async (client) => {
      const { before, rule } = await this.admin.addVersionOn(client, id, dto);
      const added = rule.versions[0]!;
      await this.audit.recordWith(client, ctx, {
        action: 'audit_rule.version_added',
        objectType: 'audit_rule',
        objectId: id,
        before: before && {
          version: before.version,
          effectiveFrom: before.effectiveFrom,
          threshold: before.threshold,
          thresholdHigh: before.thresholdHigh,
          condition: before.condition,
          outcome: before.outcome,
          authorityProvisionId: before.authorityProvisionId,
        },
        after: {
          code: rule.code,
          version: added.version,
          effectiveFrom: added.effectiveFrom,
          threshold: added.threshold,
          thresholdHigh: added.thresholdHigh,
          condition: added.condition,
          outcome: added.outcome,
          authorityProvisionId: added.authorityProvisionId,
        },
        reason: dto.notes.trim(),
      });
      return rule;
    });
  }
}
