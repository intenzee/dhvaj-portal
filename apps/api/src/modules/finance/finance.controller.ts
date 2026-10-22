import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  type BankMatchResult,
  type BooksExportRecord,
  type BooksMonth,
  type BooksSettings,
  type GstOutwardRegister,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  BankMatchDto,
  BooksExportDto,
  FinanceMonthQueryDto,
  GstRegisterFileQueryDto,
  UpdateBooksSettingsDto,
} from './finance.dto';
import { FinanceService, type FinanceFile } from './finance.service';

const file = (f: FinanceFile): StreamableFile =>
  new StreamableFile(f.buffer, {
    type: f.type,
    disposition: `attachment; filename="${f.filename}"`,
    length: f.buffer.length,
  });

/**
 * Accountant role, phase 2c (spec §3.7): Reports → Finance. Firm-wide
 * reports, so only the Accountant and the Managing Partner (entity.read_billing);
 * a partner's office-scoped view would make a register that looks whole and
 * is not. Behind ff_billing_v2 like the rest of billing.
 */
@ApiTags('finance')
@Controller('reports/finance')
@RequirePermissions(PERMISSION.entityReadBilling)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('gst-register')
  @ApiOperation({
    summary: "The month's GST outward register in the GSTR-1 layout, with its tie-out",
  })
  gstRegister(
    @CurrentPrincipal() principal: Principal,
    @Query() query: FinanceMonthQueryDto,
  ): Promise<GstOutwardRegister> {
    this.requireOn(principal);
    return this.finance.gstRegister(rlsContextFromPrincipal(principal), query.month);
  }

  @Get('gst-register/file')
  @ApiOperation({ summary: 'The register as GSTR-1 Excel sheets or the GSTN offline-tool JSON' })
  async gstRegisterFile(
    @CurrentPrincipal() principal: Principal,
    @Query() query: GstRegisterFileQueryDto,
  ): Promise<StreamableFile> {
    this.requireOn(principal);
    return file(
      await this.finance.gstRegisterFile(
        rlsContextFromPrincipal(principal),
        query.month,
        query.format,
      ),
    );
  }

  @Get('books')
  @ApiOperation({ summary: "The month's vouchers for the books, which have gone, and the exports" })
  books(
    @CurrentPrincipal() principal: Principal,
    @Query() query: FinanceMonthQueryDto,
  ): Promise<BooksMonth> {
    this.requireOn(principal);
    return this.finance.booksMonth(rlsContextFromPrincipal(principal), query.month);
  }

  @Post('books/export')
  @ApiOperation({ summary: "Export the month's pending vouchers; each goes to the books once" })
  exportBooks(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: BooksExportDto,
  ): Promise<BooksExportRecord> {
    this.requireOn(principal);
    return this.finance.exportBooks(rlsContextFromPrincipal(principal), dto.month, dto.format);
  }

  @Get('books/exports/:id/file')
  @ApiOperation({ summary: 'The file of an export: Tally XML or journal CSV' })
  async exportFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StreamableFile> {
    this.requireOn(principal);
    return file(await this.finance.exportFile(rlsContextFromPrincipal(principal), id));
  }

  @Delete('books/exports/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Undo an export: its vouchers are pending again' })
  deleteExport(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    this.requireOn(principal);
    return this.finance.deleteExport(rlsContextFromPrincipal(principal), id);
  }

  @Get('books/settings')
  @ApiOperation({ summary: 'The ledger names the books export posts to' })
  settings(@CurrentPrincipal() principal: Principal): Promise<BooksSettings> {
    this.requireOn(principal);
    return this.finance.booksSettings(rlsContextFromPrincipal(principal));
  }

  @Patch('books/settings')
  @ApiOperation({ summary: 'Rename the ledgers to match the firm’s Tally company' })
  updateSettings(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateBooksSettingsDto,
  ): Promise<BooksSettings> {
    this.requireOn(principal);
    return this.finance.updateBooksSettings(rlsContextFromPrincipal(principal), dto);
  }

  @Post('bank-match')
  @HttpCode(200)
  @ApiOperation({ summary: 'Read a bank statement and propose the invoices each credit pays' })
  bankMatch(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: BankMatchDto,
  ): Promise<BankMatchResult> {
    this.requireOn(principal);
    return this.finance.bankMatch(rlsContextFromPrincipal(principal), dto);
  }

  private requireOn(principal: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.billing, principal.officeCode)) {
      throw new NotFoundException();
    }
  }
}
