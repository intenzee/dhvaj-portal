import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type BonusWorking,
  type ExitRow,
  type ExitSettlement,
  type Form130PartB,
  type Form138Quarter,
  type TaxDeclaration,
  type TaxDeclarationRow,
  type TdsExplanation,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PayrollExitsService } from './payroll-exits.service';
import {
  ApplyBonusDto,
  BonusQueryDto,
  DecideProofDto,
  ExitReturnDto,
  LockDeclarationDto,
  MonthQueryDto,
  QuarterParamDto,
  SaveDeclarationDto,
  SaveExitDto,
  SubmitProofDto,
  TaxYearEmployeeParamDto,
  TaxYearParamDto,
} from './payroll-tax.dto';
import { PayrollTaxService } from './payroll-tax.service';
import { VersionDto } from './payroll.dto';

const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Payroll 2b (spec §4.8): tax declarations and proofs, TDS on salary
 * (s.392), Form 138 and Form 130 data, full and final, statutory bonus.
 * Reads are checked in the database (ctx_can_see_pay); HR's writes also need
 * payroll.prepare; approving a settlement is checked there too (the MP or
 * the named alternate, never the preparer).
 */
@ApiTags('payroll')
@Controller('payroll')
export class PayrollTaxController {
  constructor(
    private readonly tax: PayrollTaxService,
    private readonly exits: PayrollExitsService,
  ) {}

  // ── Declarations and proofs ────────────────────────────────────────────

  @Get('tax/:year/declarations')
  @ApiOperation({ summary: "The year's declarations: regime, proofs waiting, projected tax" })
  declarations(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearParamDto,
  ): Promise<TaxDeclarationRow[]> {
    return this.tax.declarations(rlsContextFromPrincipal(principal), p.year);
  }

  @Get('tax/:year/declarations/:employeeId')
  declaration(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearEmployeeParamDto,
  ): Promise<TaxDeclaration> {
    return this.tax.declaration(rlsContextFromPrincipal(principal), p.year, p.employeeId);
  }

  @Put('tax/:year/declarations/:employeeId')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'HR records or corrects a declaration' })
  saveDeclaration(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearEmployeeParamDto,
    @Body() dto: SaveDeclarationDto,
  ): Promise<TaxDeclaration> {
    return this.tax.saveDeclaration(rlsContextFromPrincipal(principal), p.year, p.employeeId, {
      version: dto.version,
      regime: dto.regime,
      amounts: dto.amounts,
      previousEmployment: dto.previousEmployment ?? null,
    });
  }

  @Post('tax/:year/declarations/:employeeId/lock')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'Lock (from January only proofs count) or unlock a declaration' })
  lockDeclaration(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearEmployeeParamDto,
    @Body() dto: LockDeclarationDto,
  ): Promise<TaxDeclaration> {
    return this.tax.lockDeclaration(
      rlsContextFromPrincipal(principal),
      p.year,
      p.employeeId,
      dto.version,
      dto.locked,
    );
  }

  @Post('tax/:year/declarations/:employeeId/proofs')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'HR files a proof handed in on paper' })
  submitProof(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearEmployeeParamDto,
    @Body() dto: SubmitProofDto,
  ): Promise<TaxDeclaration> {
    return this.tax.submitProof(rlsContextFromPrincipal(principal), p.year, p.employeeId, dto);
  }

  @Post('tax/proofs/:id/decision')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'Accept (in full or part) or reject a proof; never your own' })
  decideProof(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideProofDto,
  ): Promise<TaxDeclaration> {
    return this.tax.decideProof(rlsContextFromPrincipal(principal), id, dto);
  }

  @Get('tax/proofs/:id/file')
  @ApiOperation({ summary: "The proof's file (audited)" })
  async proofFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StreamableFile> {
    const f = await this.tax.proofFile(rlsContextFromPrincipal(principal), id);
    return new StreamableFile(f.buffer, {
      type: f.contentType,
      disposition: `attachment; filename="${f.filename.replace(/"/g, '')}"`,
    });
  }

  @Get('tax/tds/:employeeId')
  @ApiOperation({ summary: "How a month's TDS was worked out (from the run line)" })
  explainTds(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Query() q: MonthQueryDto,
  ): Promise<TdsExplanation> {
    return this.tax.explainTds(
      rlsContextFromPrincipal(principal),
      employeeId,
      q.month ?? currentMonth(),
    );
  }

  // ── Form 138 (quarterly TDS statement) and Form 130 Part B ────────────

  @Get('tax/:year/form138/:quarter')
  form138(
    @CurrentPrincipal() principal: Principal,
    @Param() p: QuarterParamDto,
  ): Promise<Form138Quarter> {
    return this.tax.form138(rlsContextFromPrincipal(principal), p.year, p.quarter);
  }

  @Get('tax/:year/form138/:quarter/file')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'The quarter as a workbook for the return utility (full PAN; audited)' })
  async form138File(
    @CurrentPrincipal() principal: Principal,
    @Param() p: QuarterParamDto,
  ): Promise<StreamableFile> {
    const f = await this.tax.form138File(rlsContextFromPrincipal(principal), p.year, p.quarter);
    return new StreamableFile(f.data, {
      type: xlsx,
      disposition: `attachment; filename="${f.filename}"`,
    });
  }

  @Get('tax/:year/form130/:employeeId')
  form130(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearEmployeeParamDto,
  ): Promise<Form130PartB> {
    return this.tax.form130(rlsContextFromPrincipal(principal), p.year, p.employeeId);
  }

  // ── Full and final ─────────────────────────────────────────────────────

  @Get('exits')
  @ApiOperation({ summary: 'Leavers and where their full and final stands' })
  exitList(@CurrentPrincipal() principal: Principal): Promise<ExitRow[]> {
    return this.exits.list(rlsContextFromPrincipal(principal));
  }

  @Get('exits/:employeeId')
  exit(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<ExitSettlement> {
    return this.exits.get(rlsContextFromPrincipal(principal), employeeId);
  }

  @Put('exits/:employeeId')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'HR prepares the settlement (draft)' })
  saveExit(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: SaveExitDto,
  ): Promise<ExitSettlement> {
    return this.exits.save(rlsContextFromPrincipal(principal), employeeId, dto.version, {
      leaveDays: dto.leaveDays,
      noticeShortfallDays: dto.noticeShortfallDays,
      noticePayDays: dto.noticePayDays,
      gratuityOverride: dto.gratuityOverride ?? null,
      otherEarnings: dto.otherEarnings,
      otherDeductions: dto.otherDeductions,
      note: dto.note?.trim() || null,
    });
  }

  @Post('exits/:employeeId/submit')
  @RequirePermissions(PERMISSION.payrollPrepare)
  submitExit(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: VersionDto,
  ): Promise<ExitSettlement> {
    return this.exits.transition(
      rlsContextFromPrincipal(principal),
      employeeId,
      dto.version,
      'submitted',
    );
  }

  @Post('exits/:employeeId/withdraw')
  @RequirePermissions(PERMISSION.payrollPrepare)
  withdrawExit(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: VersionDto,
  ): Promise<ExitSettlement> {
    return this.exits.transition(
      rlsContextFromPrincipal(principal),
      employeeId,
      dto.version,
      'withdrawn',
    );
  }

  @Post('exits/:employeeId/approve')
  @ApiOperation({ summary: 'The Managing Partner or the alternate approves; never the preparer' })
  approveExit(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: VersionDto,
  ): Promise<ExitSettlement> {
    return this.exits.transition(
      rlsContextFromPrincipal(principal),
      employeeId,
      dto.version,
      'approved',
    );
  }

  @Post('exits/:employeeId/return')
  returnExit(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: ExitReturnDto,
  ): Promise<ExitSettlement> {
    return this.exits.transition(
      rlsContextFromPrincipal(principal),
      employeeId,
      dto.version,
      'returned',
      dto.reason,
    );
  }

  // ── Statutory bonus ────────────────────────────────────────────────────

  @Get('bonus/:year')
  @ApiOperation({ summary: 'Statutory bonus for the year at a rate (Code on Wages)' })
  bonus(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearParamDto,
    @Query() q: BonusQueryDto,
  ): Promise<BonusWorking> {
    return this.tax.bonus(rlsContextFromPrincipal(principal), p.year, q.rate);
  }

  @Post('bonus/:year/apply')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: "Put the bonus into a month's inputs (paid with that run)" })
  applyBonus(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearParamDto,
    @Body() dto: ApplyBonusDto,
  ): Promise<BonusWorking> {
    return this.tax.applyBonus(rlsContextFromPrincipal(principal), p.year, dto);
  }
}
