import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type BillingSettings,
  type BillingSummary,
  type GlobalInvoiceRecord,
  type Paginated,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { paginate } from '../../common/pagination/pagination.dto';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CommercialService } from '../commercial/commercial.service';
import { GlobalInvoiceListQueryDto } from '../commercial/dto/commercial.dto';
import { BillingSettingsService } from './billing-settings.service';
import { UpdateBillingSettingsDto } from './billing.dto';

/**
 * Practice Services Phase 2 · Fees to cash (ff_billing_v2). PS-201: the
 * firm's billing settings and the firm-wide invoice list, which billing.manage
 * or report.read may open (RLS: the engagements they are on, plus the clients
 * of their home office for partners and managers).
 */
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly settings: BillingSettingsService,
    private readonly commercial: CommercialService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Who the firm is on its invoices: GSTIN, state, SAC, prefix, terms' })
  getSettings(@CurrentPrincipal() principal: Principal): Promise<BillingSettings> {
    this.requireOn(principal);
    return this.settings.get(rlsContextFromPrincipal(principal));
  }

  @Patch('settings')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Change the billing settings (partners; audited)' })
  updateSettings(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateBillingSettingsDto,
  ): Promise<BillingSettings> {
    this.requireOn(principal);
    return this.settings.update(rlsContextFromPrincipal(principal), dto);
  }

  @Get('invoices')
  @ApiOperation({
    summary:
      'Invoices across the clients and engagements you may bill (billing.manage or report.read)',
  })
  async invoices(
    @CurrentPrincipal() principal: Principal,
    @Query() query: GlobalInvoiceListQueryDto,
  ): Promise<Paginated<GlobalInvoiceRecord>> {
    this.requireOn(principal);
    requireBillingReader(principal);
    const filter: {
      status?: GlobalInvoiceListQueryDto['status'];
      overdueOnly?: boolean;
      search?: string;
    } = {};
    if (query.status) filter.status = query.status;
    if (query.overdueOnly !== undefined) filter.overdueOnly = query.overdueOnly;
    if (query.search) filter.search = query.search;
    const result = await this.commercial.listAllInvoices(
      rlsContextFromPrincipal(principal),
      query,
      filter,
    );
    return paginate(result, query);
  }

  @Get('invoices/summary')
  @ApiOperation({ summary: 'Counts and totals over the invoices you may bill' })
  summary(@CurrentPrincipal() principal: Principal): Promise<BillingSummary> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.commercial.billingSummary(rlsContextFromPrincipal(principal));
  }

  private requireOn(principal: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.billing, principal.officeCode)) {
      throw new NotFoundException();
    }
  }
}

function requireBillingReader(principal: Principal): void {
  const held = new Set(principal.permissions);
  if (!held.has(PERMISSION.billingManage) && !held.has(PERMISSION.reportRead)) {
    throw new ForbiddenException('Missing required permission(s): billing.manage or report.read.');
  }
}
