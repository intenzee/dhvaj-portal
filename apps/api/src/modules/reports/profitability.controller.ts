import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ProfitabilityReport, type RateCardsResponse } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ProfitabilityService } from './profitability.service';
import {
  ProfitabilityQueryDto,
  PutEmployeeRateDto,
  PutRateCardsDto,
  PutWorkingCalendarDto,
} from './dto/profitability.dto';

/**
 * Practice Services PS-302 — rate cards (cost and charge-out per grade, with
 * per-person overrides) and the working calendar. practice.finance only; the
 * tables are FORCE RLS on it too.
 */
@ApiTags('reports')
@Controller('rate-cards')
export class RateCardsController {
  constructor(private readonly svc: ProfitabilityService) {}

  @Get()
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({ summary: 'Rate cards by grade, per-person overrides, the working calendar' })
  get(@CurrentPrincipal() principal: Principal): Promise<RateCardsResponse> {
    return this.svc.rateCards(rlsContextFromPrincipal(principal));
  }

  @Put()
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({ summary: 'Set grades’ rates from a day (the same day again replaces them)' })
  put(
    @CurrentPrincipal() principal: Principal,
    @Body() body: PutRateCardsDto,
  ): Promise<RateCardsResponse> {
    return this.svc.putRateCards(rlsContextFromPrincipal(principal), body);
  }

  @Put('employees')
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({ summary: 'Set one person’s rates from a day, over their grade’s' })
  putEmployee(
    @CurrentPrincipal() principal: Principal,
    @Body() body: PutEmployeeRateDto,
  ): Promise<RateCardsResponse> {
    return this.svc.putEmployeeRate(rlsContextFromPrincipal(principal), body);
  }

  @Put('calendar')
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({ summary: 'The working weekdays and hours a day (utilisation)' })
  putCalendar(
    @CurrentPrincipal() principal: Principal,
    @Body() body: PutWorkingCalendarDto,
  ): Promise<RateCardsResponse> {
    return this.svc.putCalendar(rlsContextFromPrincipal(principal), body);
  }

  @Delete('employees/:id')
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({ summary: 'Remove a person’s rate row' })
  deleteEmployee(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RateCardsResponse> {
    return this.svc.deleteEmployeeRate(rlsContextFromPrincipal(principal), id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({ summary: 'Remove a grade’s rate row (one entered by mistake)' })
  delete(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RateCardsResponse> {
    return this.svc.deleteRateCard(rlsContextFromPrincipal(principal), id);
  }
}

/**
 * PS-302 — realisation and margin by client, engagement, service, partner or
 * month. practice.finance only; the figures are the caller's own view (RLS):
 * an office partner sees their office, the Managing Partner the firm.
 */
@ApiTags('reports')
@Controller('reports/profitability')
export class ProfitabilityController {
  constructor(private readonly svc: ProfitabilityService) {}

  @Get()
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({
    summary: 'Time cost, standard value, billed, collected, realisation and margin',
    description:
      'Over a period (the last full quarter by default), by client | engagement | service | ' +
      'partner | month, filterable by partner, office, service and client. Ranked by margin; ' +
      'the lowest 10 (and any loss) are flagged `bottom`.',
  })
  report(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ProfitabilityQueryDto,
  ): Promise<ProfitabilityReport> {
    return this.svc.report(rlsContextFromPrincipal(principal), query);
  }

  @Get('csv')
  @RequirePermissions(PERMISSION.practiceFinance)
  @ApiOperation({ summary: 'The profitability report as CSV' })
  async csv(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ProfitabilityQueryDto,
  ): Promise<StreamableFile> {
    const csv = await this.svc.csv(rlsContextFromPrincipal(principal), query);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="profitability-${query.by ?? 'client'}.csv"`,
    });
  }
}
