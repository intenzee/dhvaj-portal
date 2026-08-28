import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type EngagementCommercial,
  type InvoiceDetail,
  type InvoiceRecord,
  type Paginated,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { CommercialService } from './commercial.service';
import {
  CreateInvoiceDto,
  InvoiceLineDto,
  InvoiceListQueryDto,
  SetInvoiceStatusDto,
  UpdateInvoiceDto,
  UpsertCommercialDto,
} from './dto/commercial.dto';

/**
 * Commercial Scope & Billing (spec §31), routed under the engagement. Reads need
 * `engagement.read` (RLS scopes to members); writes need `engagement.manage`
 * (RLS scopes to leads) — the same floor as the components and review engines.
 */
@ApiTags('commercial')
@Controller('engagements')
export class CommercialController {
  constructor(private readonly commercial: CommercialService) {}

  // ── Commercial configuration ────────────────────────────────────────────

  @Get(':id/commercial')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Get the engagement’s commercial configuration (§31).' })
  getCommercial(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EngagementCommercial> {
    return this.commercial.getCommercial(rlsContextFromPrincipal(principal), id);
  }

  @Patch(':id/commercial')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Create or amend the engagement’s commercial configuration (audited).' })
  upsertCommercial(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertCommercialDto,
  ): Promise<EngagementCommercial> {
    return this.commercial.upsertCommercial(rlsContextFromPrincipal(principal), id, dto);
  }

  // ── Invoices ────────────────────────────────────────────────────────────

  @Get(':id/invoices')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List the engagement’s invoices (paginated; filter ?status=).' })
  listInvoices(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: InvoiceListQueryDto,
  ): Promise<Paginated<InvoiceRecord>> {
    const filter = query.status ? { status: query.status } : {};
    return this.commercial
      .listInvoices(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Post(':id/invoices')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Create a draft invoice with optional lines (audited).' })
  createInvoice(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateInvoiceDto,
  ): Promise<InvoiceDetail> {
    return this.commercial.createInvoice(rlsContextFromPrincipal(principal), id, dto);
  }

  @Get(':id/invoices/:invoiceId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Get an invoice with its line items.' })
  getInvoice(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<InvoiceDetail> {
    return this.commercial.getInvoice(rlsContextFromPrincipal(principal), id, invoiceId);
  }

  @Patch(':id/invoices/:invoiceId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Amend a draft invoice header (audited; optimistic-locked).' })
  updateInvoice(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() dto: UpdateInvoiceDto,
  ): Promise<InvoiceDetail> {
    return this.commercial.updateInvoice(rlsContextFromPrincipal(principal), id, invoiceId, dto);
  }

  @Post(':id/invoices/:invoiceId/status')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Transition an invoice’s status (§31: issue / mark paid / void; audited).',
  })
  setStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() dto: SetInvoiceStatusDto,
  ): Promise<InvoiceDetail> {
    return this.commercial.setStatus(rlsContextFromPrincipal(principal), id, invoiceId, dto);
  }

  @Post(':id/invoices/:invoiceId/lines')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a line to a draft invoice (audited).' })
  addLine(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() dto: InvoiceLineDto,
  ): Promise<InvoiceDetail> {
    return this.commercial.addLine(rlsContextFromPrincipal(principal), id, invoiceId, dto);
  }

  @Delete(':id/invoices/:invoiceId/lines/:lineId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a line from a draft invoice (audited).' })
  removeLine(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
  ): Promise<InvoiceDetail> {
    return this.commercial.removeLine(rlsContextFromPrincipal(principal), id, invoiceId, lineId);
  }
}
