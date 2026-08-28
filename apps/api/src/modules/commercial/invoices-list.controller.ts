import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type BillingSummary,
  type GlobalInvoiceRecord,
  type Paginated,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { CommercialService } from './commercial.service';
import { GlobalInvoiceListQueryDto } from './dto/commercial.dto';

/**
 * Firm-wide Billing & Collections view (spec §31). A cross-engagement invoice
 * list and rollup, gated by `report.read` (the management tier) and RLS-scoped
 * exactly like the per-engagement invoice list — the caller sees an invoice
 * only for an engagement they are on. Read-only: all writes stay on the
 * per-engagement commercial endpoints.
 */
@ApiTags('billing')
@Controller('invoices')
export class InvoicesListController {
  constructor(private readonly commercial: CommercialService) {}

  @Get()
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({
    summary: 'List invoices across all accessible engagements (paginated)',
    description: 'RLS-scoped like the per-engagement list. Filter by status/overdueOnly/search.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: GlobalInvoiceListQueryDto,
  ): Promise<Paginated<GlobalInvoiceRecord>> {
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

  @Get('summary')
  @RequirePermissions(PERMISSION.reportRead)
  @ApiOperation({
    summary: 'Firm-wide billing rollup (counts + summed totals) over visible invoices',
  })
  summary(@CurrentPrincipal() principal: Principal): Promise<BillingSummary> {
    return this.commercial.billingSummary(rlsContextFromPrincipal(principal));
  }
}
