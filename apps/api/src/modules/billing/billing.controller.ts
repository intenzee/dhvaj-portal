import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type BillingSettings,
  type BillingSummary,
  type ClientStatement,
  type GlobalInvoiceRecord,
  type InvoiceAdjustment,
  type ReceiptRecord,
  type Paginated,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { paginate } from '../../common/pagination/pagination.dto';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CommercialService } from '../commercial/commercial.service';
import { GlobalInvoiceListQueryDto } from '../commercial/dto/commercial.dto';
import { BillingSettingsService } from './billing-settings.service';
import { AdjustmentsService } from './adjustments.service';
import {
  AdjustmentListQueryDto,
  CreateReceiptDto,
  DecideAdjustmentDto,
  ReceiptListQueryDto,
  RequestCreditNoteDto,
  RequestWriteOffDto,
  ReverseReceiptDto,
  UpdateBillingSettingsDto,
} from './billing.dto';
import { ReceiptsService } from './receipts.service';

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
    private readonly receipts: ReceiptsService,
    private readonly adjustments: AdjustmentsService,
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

  // ── PS-202 · receipts ───────────────────────────────────────────────────

  @Get('receipts')
  @ApiOperation({ summary: 'Receipts from the clients you bill (billing.manage or report.read)' })
  async listReceipts(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ReceiptListQueryDto,
  ): Promise<Paginated<ReceiptRecord>> {
    this.requireOn(principal);
    requireBillingReader(principal);
    const filter: { clientId?: string; from?: string; to?: string } = {};
    if (query.clientId) filter.clientId = query.clientId;
    if (query.from) filter.from = query.from;
    if (query.to) filter.to = query.to;
    const result = await this.receipts.list(rlsContextFromPrincipal(principal), query, filter);
    return paginate(result, query);
  }

  @Get('receipts/:id')
  @ApiOperation({ summary: 'One receipt with its allocations' })
  getReceipt(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ReceiptRecord> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.receipts.get(rlsContextFromPrincipal(principal), id);
  }

  @Post('receipts')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({
    summary:
      'Record a receipt (net + TDS) and allocate it; without allocations, oldest open invoice first',
  })
  createReceipt(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateReceiptDto,
  ): Promise<ReceiptRecord> {
    this.requireOn(principal);
    return this.receipts.create(rlsContextFromPrincipal(principal), dto);
  }

  @Post('receipts/:id/reverse')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Reverse a receipt with a reason; the invoices it paid reopen' })
  reverseReceipt(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseReceiptDto,
  ): Promise<ReceiptRecord> {
    this.requireOn(principal);
    return this.receipts.reverse(rlsContextFromPrincipal(principal), id, dto);
  }

  @Get('clients/:entityId/statement')
  @ApiOperation({ summary: "A client's invoices, receipts, TDS and balance" })
  statement(
    @CurrentPrincipal() principal: Principal,
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
  ): Promise<ClientStatement> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.receipts.statement(rlsContextFromPrincipal(principal), entityId);
  }

  // ── PS-205 · credit notes and write-offs ────────────────────────────────

  @Get('adjustments')
  @ApiOperation({
    summary:
      "Credit notes and write-offs: one invoice's, or all pending (billing.manage or report.read)",
  })
  listAdjustments(
    @CurrentPrincipal() principal: Principal,
    @Query() query: AdjustmentListQueryDto,
  ): Promise<InvoiceAdjustment[]> {
    this.requireOn(principal);
    requireBillingReader(principal);
    const filter: { invoiceId?: string; status?: AdjustmentListQueryDto['status'] } = {};
    if (query.invoiceId) filter.invoiceId = query.invoiceId;
    if (query.status) filter.status = query.status;
    return this.adjustments.list(rlsContextFromPrincipal(principal), filter);
  }

  @Post('invoices/:invoiceId/credit-notes')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'Ask for a credit note against an issued invoice (a partner approves)' })
  requestCreditNote(
    @CurrentPrincipal() principal: Principal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() dto: RequestCreditNoteDto,
  ): Promise<InvoiceAdjustment> {
    this.requireOn(principal);
    return this.adjustments.requestCreditNote(rlsContextFromPrincipal(principal), invoiceId, dto);
  }

  @Post('invoices/:invoiceId/write-offs')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'Ask to write off part of an invoice (a partner approves)' })
  requestWriteOff(
    @CurrentPrincipal() principal: Principal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() dto: RequestWriteOffDto,
  ): Promise<InvoiceAdjustment> {
    this.requireOn(principal);
    return this.adjustments.requestWriteOff(rlsContextFromPrincipal(principal), invoiceId, dto);
  }

  @Post('credit-notes/:id/decision')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Approve (numbers it, reduces the balance) or reject a credit note' })
  decideCreditNote(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideAdjustmentDto,
  ): Promise<InvoiceAdjustment> {
    this.requireOn(principal);
    return this.adjustments.decide(rlsContextFromPrincipal(principal), 'credit_note', id, dto);
  }

  @Post('write-offs/:id/decision')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Approve (reduces the balance) or reject a write-off' })
  decideWriteOff(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideAdjustmentDto,
  ): Promise<InvoiceAdjustment> {
    this.requireOn(principal);
    return this.adjustments.decide(rlsContextFromPrincipal(principal), 'write_off', id, dto);
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
