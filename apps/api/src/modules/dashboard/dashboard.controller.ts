import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  RISK_TILE_PAGE,
  RISK_TILE_PAGE_MAX,
  RISK_TILES,
  type DashboardSummary,
  type RiskDashboard,
  type RiskTile,
  type RiskTileKey,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { DashboardService } from './dashboard.service';
import { RiskService } from './risk.service';

/**
 * Home dashboard (Phase 12). One RLS-scoped summary drives every role's cards —
 * the counts reflect only what the caller can see (`engagement.read` is held by
 * all staff).
 */
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly risk: RiskService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('summary')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Role-scoped counts for the Home dashboard cards' })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Query('dueSoonDays', new DefaultValuePipe(7), new ParseIntPipe()) dueSoonDays: number,
  ): Promise<DashboardSummary> {
    const days = Math.min(Math.max(dueSoonDays, 1), 90);
    return this.dashboard.summary(rlsContextFromPrincipal(principal), days);
  }

  /** PS-301 · every risk tile, each with its first items. */
  @Get('risk')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({ summary: 'The partner risk dashboard: nine tiles, each with its first items' })
  riskDashboard(
    @CurrentPrincipal() principal: Principal,
    @Query('limit', new DefaultValuePipe(RISK_TILE_PAGE), new ParseIntPipe()) limit: number,
  ): Promise<RiskDashboard> {
    this.requireRisk(principal);
    return this.risk.dashboard(rlsContextFromPrincipal(principal), pageSize(limit));
  }

  /** PS-301 · one tile, paged (the web loads each tile on its own). */
  @Get('risk/:tile')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({ summary: 'One risk tile, paged' })
  async riskTile(
    @CurrentPrincipal() principal: Principal,
    @Param('tile') tile: string,
    @Query('limit', new DefaultValuePipe(RISK_TILE_PAGE), new ParseIntPipe()) limit: number,
    @Query('offset', new DefaultValuePipe(0), new ParseIntPipe()) offset: number,
  ): Promise<RiskTile> {
    this.requireRisk(principal);
    if (!(RISK_TILES as readonly string[]).includes(tile)) {
      throw new NotFoundException('There is no such risk tile.');
    }
    if (offset < 0) throw new BadRequestException('offset must be 0 or more.');
    const { tile: body } = await this.risk.tile(
      rlsContextFromPrincipal(principal),
      tile as RiskTileKey,
      pageSize(limit),
      offset,
    );
    return body;
  }

  private requireRisk(principal: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.partnerRisk, principal.officeCode)) {
      throw new NotFoundException();
    }
  }
}

function pageSize(limit: number): number {
  return Math.min(Math.max(limit, 1), RISK_TILE_PAGE_MAX);
}
