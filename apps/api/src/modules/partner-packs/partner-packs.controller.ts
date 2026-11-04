import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  partnerPackMonth,
  type BuildPartnerPackInput,
  type PartnerPackFigures,
  type PartnerPackSummary,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { istToday } from '../engagements/time/auto-time';
import { PartnerPacksService } from './partner-packs.service';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * PS-303 · the partner's monthly pack. Built for every partner on the 3rd; a
 * partner (or the Managing Partner) can build a month again for themself, and
 * download any pack they can see as a PDF.
 */
@ApiTags('reports')
@Controller('reports/partner-packs')
export class PartnerPacksController {
  constructor(
    private readonly packs: PartnerPacksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private requireOn(principal: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.partnerRisk, principal.officeCode)) {
      throw new NotFoundException();
    }
  }

  @Get()
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({ summary: 'The partner packs the caller can see, newest month first' })
  list(@CurrentPrincipal() principal: Principal): Promise<PartnerPackSummary[]> {
    this.requireOn(principal);
    return this.packs.list(rlsContextFromPrincipal(principal));
  }

  @Post()
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({ summary: "Build (or build again) the caller's own pack for a month" })
  build(
    @CurrentPrincipal() principal: Principal,
    @Body() body: BuildPartnerPackInput,
  ): Promise<PartnerPackSummary> {
    this.requireOn(principal);
    if (!principal.employeeId) throw new ForbiddenException('Packs are for partners on the staff.');
    if (!principal.roles.some((r) => r === 'partner' || r === 'managing_partner')) {
      throw new ForbiddenException('Only a partner has a partner pack.');
    }
    const month = body?.month ?? partnerPackMonth(istToday(new Date()));
    if (!MONTH.test(month)) throw new BadRequestException('Give the month as YYYY-MM.');
    if (month > istToday(new Date()).slice(0, 7)) {
      throw new BadRequestException('That month has not started yet.');
    }
    return this.packs.build(
      this.packs.partnerOf({ ...principal, employeeId: principal.employeeId }),
      month,
      false,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({ summary: "One pack's figures" })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PartnerPackFigures & { id: string }> {
    this.requireOn(principal);
    return this.packs.get(rlsContextFromPrincipal(principal), id);
  }

  @Get(':id/pdf')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({ summary: 'One pack as a PDF' })
  async pdf(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    this.requireOn(principal);
    const pdf = await this.packs.pdf(rlsContextFromPrincipal(principal), id);
    return new StreamableFile(pdf.body, {
      type: 'application/pdf',
      disposition: `attachment; filename="${pdf.filename}"`,
    });
  }
}
