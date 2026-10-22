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
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type BillableTimeReport,
  type BillingSettings,
  type BillingSummary,
  type ClientStatement,
  type GlobalInvoiceRecord,
  type InvoiceAdjustment,
  type FeeMilestone,
  type FeeWaiver,
  type InvoiceDetail,
  type InvoiceReminderRecord,
  type InvoiceReminderResult,
  type InvoiceTimeEntry,
  type ReceiptRecord,
  type ReversalRequest,
  type Paginated,
  type SetAsideFeesResult,
  type TdsImportResult,
  type TdsMatchReport,
  type TdsReminderResult,
  type UnbilledReport,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { paginate } from '../../common/pagination/pagination.dto';
import {
  CurrentPrincipal,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CommercialService } from '../commercial/commercial.service';
import { GlobalInvoiceListQueryDto } from '../commercial/dto/commercial.dto';
import { BillingSettingsService } from './billing-settings.service';
import { AdjustmentsService } from './adjustments.service';
import {
  AdjustmentListQueryDto,
  BillableTimeQueryDto,
  CreateFeeMilestoneDto,
  CreateReceiptDto,
  DecideAdjustmentDto,
  DraftFromTimeDto,
  DraftFromUnbilledDto,
  FeeWaiversQueryDto,
  ImportTdsCreditsDto,
  ReceiptListQueryDto,
  RequestCreditNoteDto,
  RemindInvoiceDto,
  RemindTdsDto,
  RestoreFeeDto,
  RequestReversalDto,
  RequestWriteOffDto,
  ReversalListQueryDto,
  ReverseReceiptDto,
  SetAsideFeesDto,
  TdsMatchQueryDto,
  UnbilledQueryDto,
  UpdateBillingSettingsDto,
  VoidCreditNoteDto,
} from './billing.dto';
import { ReceiptsService } from './receipts.service';
import { ReceivablesService } from './receivables.service';
import { ReversalRequestsService } from './reversal-requests.service';
import { TdsCreditsService } from './tds-credits.service';
import { TimeBillingService } from './time-billing.service';
import { UnbilledService } from './unbilled.service';

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
    private readonly receivables: ReceivablesService,
    private readonly unbilled: UnbilledService,
    private readonly tds: TdsCreditsService,
    private readonly time: TimeBillingService,
    private readonly reversals: ReversalRequestsService,
  ) {}

  @Get('settings')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.billingManage)
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

  // ── §3.5 · asking a partner to void an issued invoice or reverse a receipt ──

  @Get('reversal-requests')
  @ApiOperation({
    summary: 'Requests to void an invoice or reverse a receipt (the client billers)',
  })
  listReversalRequests(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ReversalListQueryDto,
  ): Promise<ReversalRequest[]> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.reversals.list(rlsContextFromPrincipal(principal), {
      ...(query.status ? { status: query.status } : {}),
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.receiptId ? { receiptId: query.receiptId } : {}),
    });
  }

  @Post('reversal-requests')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'Ask a partner to void an issued invoice or reverse a receipt' })
  requestReversal(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: RequestReversalDto,
  ): Promise<ReversalRequest> {
    this.requireOn(principal);
    return this.reversals.request(rlsContextFromPrincipal(principal), dto);
  }

  @Post('reversal-requests/:id/decision')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Approve (the void or reversal happens now) or reject a request' })
  decideReversal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideAdjustmentDto,
  ): Promise<ReversalRequest> {
    this.requireOn(principal);
    return this.reversals.decide(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post('reversal-requests/:id/withdraw')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'Take back your own pending request' })
  withdrawReversal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ReversalRequest> {
    this.requireOn(principal);
    return this.reversals.withdraw(rlsContextFromPrincipal(principal), id);
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

  @Post('credit-notes/:id/void')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({
    summary:
      'Void an approved credit note with a reason (not its requester; refused once its GST return is filed). The number stays used and the balance comes back.',
  })
  voidCreditNote(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidCreditNoteDto,
  ): Promise<InvoiceAdjustment> {
    this.requireOn(principal);
    return this.adjustments.voidCreditNote(rlsContextFromPrincipal(principal), id, dto);
  }

  @Get('credit-notes/:id/pdf')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.billingManage)
  @ApiOperation({ summary: 'An approved (or voided) credit note as a PDF (CGST rule 53)' })
  async creditNotePdf(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StreamableFile> {
    this.requireOn(principal);
    const pdf = await this.adjustments.creditNotePdf(rlsContextFromPrincipal(principal), id);
    return new StreamableFile(pdf.data, {
      type: 'application/pdf',
      disposition: `inline; filename="${pdf.filename}"`,
    });
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

  @Post('invoices/:invoiceId/remind')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({
    summary: 'Remind the client of an open invoice (e-mail, WhatsApp link or text to copy); logged',
  })
  remind(
    @CurrentPrincipal() principal: Principal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() dto: RemindInvoiceDto,
  ): Promise<InvoiceReminderResult> {
    this.requireOn(principal);
    return this.receivables.remind(rlsContextFromPrincipal(principal), invoiceId, dto);
  }

  @Get('invoices/:invoiceId/reminders')
  @ApiOperation({ summary: 'The payment reminders sent about an invoice, newest first' })
  reminders(
    @CurrentPrincipal() principal: Principal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<InvoiceReminderRecord[]> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.receivables.reminders(rlsContextFromPrincipal(principal), invoiceId);
  }

  @Get('unbilled')
  @ApiOperation({
    summary: 'Fixed fees due and on no invoice, per engagement (PS-206; time joins in PS-302)',
  })
  unbilledFees(
    @CurrentPrincipal() principal: Principal,
    @Query() query: UnbilledQueryDto,
  ): Promise<UnbilledReport> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.unbilled.report(rlsContextFromPrincipal(principal), query.partnerId ?? null);
  }

  @Post('unbilled/draft')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'Put the chosen due fee periods on a new draft invoice' })
  draftFromUnbilled(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: DraftFromUnbilledDto,
  ): Promise<InvoiceDetail> {
    this.requireOn(principal);
    return this.unbilled.draft(rlsContextFromPrincipal(principal), dto);
  }

  @Post('unbilled/set-aside')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({
    summary:
      'Set due fee periods aside: billed outside the app (at once), or not billed (a waiver a partner approves)',
  })
  setAsideFees(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: SetAsideFeesDto,
  ): Promise<SetAsideFeesResult> {
    this.requireOn(principal);
    return this.unbilled.setAside(rlsContextFromPrincipal(principal), dto);
  }

  @Get('fee-waivers')
  @ApiOperation({ summary: 'Waivers of unbilled fees the caller may see, newest first' })
  feeWaivers(
    @CurrentPrincipal() principal: Principal,
    @Query() query: FeeWaiversQueryDto,
  ): Promise<FeeWaiver[]> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.unbilled.waivers(rlsContextFromPrincipal(principal), query.status ?? null);
  }

  @Post('fee-waivers/:id/decision')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Approve (sets the periods aside as not billed) or reject a waiver' })
  decideFeeWaiver(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideAdjustmentDto,
  ): Promise<FeeWaiver> {
    this.requireOn(principal);
    return this.unbilled.decideWaiver(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post('unbilled/restore')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'List a set-aside fee period as unbilled again' })
  restoreFee(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: RestoreFeeDto,
  ): Promise<{ restored: string }> {
    this.requireOn(principal);
    return this.unbilled.restore(rlsContextFromPrincipal(principal), dto);
  }

  @Get('engagements/:engagementId/fee-milestones')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.engagementReadCommercial)
  @ApiOperation({ summary: "The engagement's fee milestones and events, with where each stands" })
  feeMilestones(
    @CurrentPrincipal() principal: Principal,
    @Param('engagementId', new ParseUUIDPipe()) engagementId: string,
  ): Promise<FeeMilestone[]> {
    this.requireOn(principal);
    return this.unbilled.milestones(rlsContextFromPrincipal(principal), engagementId);
  }

  @Post('engagements/:engagementId/fee-milestones')
  // Agreeing a fee is the partner's commercial call (spec §3.5), not billing.
  @RequirePermissions(PERMISSION.feeAgree)
  @ApiOperation({ summary: 'Agree a fee on a milestone or an event; due on its date' })
  addFeeMilestone(
    @CurrentPrincipal() principal: Principal,
    @Param('engagementId', new ParseUUIDPipe()) engagementId: string,
    @Body() dto: CreateFeeMilestoneDto,
  ): Promise<FeeMilestone> {
    this.requireOn(principal);
    return this.unbilled.addMilestone(rlsContextFromPrincipal(principal), engagementId, dto);
  }

  @Post('fee-milestones/:id/cancel')
  @RequirePermissions(PERMISSION.feeAgree)
  @ApiOperation({ summary: 'Cancel a fee milestone that is on no live invoice' })
  cancelFeeMilestone(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<FeeMilestone> {
    this.requireOn(principal);
    return this.unbilled.cancelMilestone(rlsContextFromPrincipal(principal), id);
  }

  // ── PS-206 (fix) · time billed once ─────────────────────────────────────

  @Get('engagements/:engagementId/time')
  @ApiOperation({
    summary:
      "The engagement's stopped, billable time (?from=&to=, IST): unbilled, or on which live invoice",
  })
  billableTime(
    @CurrentPrincipal() principal: Principal,
    @Param('engagementId', new ParseUUIDPipe()) engagementId: string,
    @Query() query: BillableTimeQueryDto,
  ): Promise<BillableTimeReport> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.time.report(rlsContextFromPrincipal(principal), engagementId, {
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    });
  }

  @Post('engagements/:engagementId/time/draft')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({
    summary:
      'Put the chosen time on a new draft: a line per stream at the hourly rate typed; never twice',
  })
  draftFromTime(
    @CurrentPrincipal() principal: Principal,
    @Param('engagementId', new ParseUUIDPipe()) engagementId: string,
    @Body() dto: DraftFromTimeDto,
  ): Promise<InvoiceDetail> {
    this.requireOn(principal);
    return this.time.draft(rlsContextFromPrincipal(principal), engagementId, dto);
  }

  @Get('invoices/:invoiceId/time')
  @ApiOperation({ summary: 'The time entries each line of an invoice covers' })
  invoiceTime(
    @CurrentPrincipal() principal: Principal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<InvoiceTimeEntry[]> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.time.invoiceTime(rlsContextFromPrincipal(principal), invoiceId);
  }

  @Post('tds-credits/import')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({
    summary:
      "Import the firm's 26AS (TRACES text export) or a Form 16A; replaces what it covers (PS-204)",
  })
  importTdsCredits(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ImportTdsCreditsDto,
  ): Promise<TdsImportResult> {
    this.requireOn(principal);
    return this.tds.import(rlsContextFromPrincipal(principal), dto);
  }

  @Get('tds-credits/match')
  @ApiOperation({
    summary:
      'The 26AS against the TDS booked on receipts: matched, in 26AS but not booked, booked but missing — by client',
  })
  matchTdsCredits(
    @CurrentPrincipal() principal: Principal,
    @Query() query: TdsMatchQueryDto,
  ): Promise<TdsMatchReport> {
    this.requireOn(principal);
    requireBillingReader(principal);
    return this.tds.match(
      rlsContextFromPrincipal(principal),
      query.financialYear,
      query.quarter ?? null,
    );
  }

  @Post('tds-credits/remind')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({
    summary:
      'Ask a client to file or correct their TDS return for deductions missing from the 26AS; logged',
  })
  remindTds(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: RemindTdsDto,
  ): Promise<TdsReminderResult> {
    this.requireOn(principal);
    return this.tds.remind(rlsContextFromPrincipal(principal), dto);
  }

  private requireOn(principal: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.billing, principal.officeCode)) {
      throw new NotFoundException();
    }
  }
}

export function requireBillingReader(principal: Principal): void {
  const held = new Set(principal.permissions);
  if (!held.has(PERMISSION.billingManage) && !held.has(PERMISSION.reportRead)) {
    throw new ForbiddenException('Missing required permission(s): billing.manage or report.read.');
  }
}
