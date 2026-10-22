import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type AccountsDesk,
  type ApprovalItem,
  type BillingClientRow,
  type ClientBillingProfile,
  type EngagementCommercialView,
  type InvoiceIssueRequest,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { requireBillingReader } from '../billing/billing.controller';
import {
  ApprovalListQueryDto,
  BillingClientListQueryDto,
  RequestInvoiceIssueDto,
} from './accounts.dto';
import { AccountsService } from './accounts.service';

/**
 * Accountant role, phase 1 (spec §3.4, §7.4): reads open to billing.manage or
 * report.read; RLS and the billing views decide which clients. Behind
 * ff_billing_v2 like the rest of billing.
 */
@ApiTags('billing')
@Controller()
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('accounts/desk')
  @ApiOperation({ summary: "The Accounts desk: this month's billing, receivables, work queues" })
  desk(@CurrentPrincipal() principal: Principal): Promise<AccountsDesk> {
    this.requireReader(principal);
    return this.accounts.desk(rlsContextFromPrincipal(principal));
  }

  @Get('billing/clients')
  @ApiOperation({ summary: 'Clients the caller may bill, largest balance first' })
  clients(
    @CurrentPrincipal() principal: Principal,
    @Query() query: BillingClientListQueryDto,
  ): Promise<BillingClientRow[]> {
    this.requireReader(principal);
    return this.accounts.clients(rlsContextFromPrincipal(principal), {
      ...(query.q ? { q: query.q } : {}),
      owing: query.owing === 'true',
      ...(query.limit ? { limit: query.limit } : {}),
    });
  }

  @Get('billing/clients/:id/profile')
  @ApiOperation({ summary: "A client's billing profile: name, PAN, GSTIN, address, contact" })
  profile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ClientBillingProfile> {
    this.requireReader(principal);
    return this.accounts.profile(rlsContextFromPrincipal(principal), id);
  }

  @Get('billing/engagements/:id')
  @ApiOperation({
    summary: "An engagement's commercial view: header, fees, billable hours, invoices",
  })
  engagement(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EngagementCommercialView> {
    this.requireReader(principal);
    return this.accounts.engagement(rlsContextFromPrincipal(principal), id);
  }

  @Post('billing/invoices/:id/request-issue')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'Ask the engagement partner to issue a draft with an ad-hoc line' })
  requestIssue(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RequestInvoiceIssueDto,
  ): Promise<InvoiceIssueRequest> {
    this.requireOn(principal);
    return this.accounts.requestIssue(rlsContextFromPrincipal(principal), id, dto.note ?? null);
  }

  @Post('billing/issue-requests/:id/withdraw')
  @RequirePermissions(PERMISSION.billingManage)
  @ApiOperation({ summary: 'Take back your request to issue an invoice' })
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InvoiceIssueRequest> {
    this.requireOn(principal);
    return this.accounts.withdrawIssueRequest(rlsContextFromPrincipal(principal), id);
  }

  @Get('billing/approvals')
  @ApiOperation({
    summary: 'Requests waiting on a partner: issue, credit note, write-off, fee waiver',
  })
  approvals(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ApprovalListQueryDto,
  ): Promise<ApprovalItem[]> {
    this.requireReader(principal);
    return this.accounts.approvals(rlsContextFromPrincipal(principal), query);
  }

  private requireReader(principal: Principal): void {
    this.requireOn(principal);
    requireBillingReader(principal);
  }

  private requireOn(principal: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.billing, principal.officeCode)) {
      throw new NotFoundException();
    }
  }
}
