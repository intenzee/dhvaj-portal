import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  type BankChangeRequest,
  type EmployeePayDetails,
  type Payslip,
  type PayRosterRow,
  type PaySettingsRecord,
  type PayrollJournal,
  type PayrollMonthInputs,
  type PayrollRunDetail,
  type PayrollRunSummary,
  type PayrollRunTotals,
  type SalaryStructure,
  type StatutoryWorking,
} from '@hsdg/contracts';
import {
  CurrentPrincipal,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PayrollRunsService } from './payroll-runs.service';
import {
  AddApproverDto,
  CreateRunDto,
  DecideBankChangeDto,
  DecideDto,
  MarkPaidDto,
  MonthEmployeeParamDto,
  MonthParamDto,
  PayDetailsDto,
  ProposeStructureDto,
  RecordChallanDto,
  ReturnRunDto,
  RevealDto,
  SaveSettingsDto,
  SetInputsDto,
  StatutoryKindParamDto,
  VersionDto,
} from './payroll.dto';
import { PayrollService } from './payroll.service';

const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Payroll (spec §4.8). Who may see pay is decided in the database
 * (ctx_can_see_pay, ctx_may_approve_pay), so the alternate approver needs no
 * permission of their own: read and approve routes check it there. HR's
 * writes also need payroll.prepare; the Accountant's routes payroll.read_summary.
 */
@ApiTags('payroll')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly runs: PayrollRunsService,
  ) {}

  // ── Settings and approvers ─────────────────────────────────────────────

  @Get('settings')
  @ApiOperation({ summary: 'Statutory settings in force (PF, ESI, PT, gratuity, stipend minimum)' })
  settings(@CurrentPrincipal() principal: Principal): Promise<PaySettingsRecord> {
    return this.payroll.settings(rlsContextFromPrincipal(principal));
  }

  @Post('settings')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'Confirm settings from a date (each April)' })
  saveSettings(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: SaveSettingsDto,
  ): Promise<PaySettingsRecord> {
    return this.payroll.saveSettings(
      rlsContextFromPrincipal(principal),
      dto.effectiveFrom,
      dto.rules,
    );
  }

  @Get('approvers')
  @ApiOperation({ summary: 'The named alternate approver (besides the Managing Partner)' })
  approvers(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ userId: string; displayName: string }[]> {
    return this.payroll.approvers(rlsContextFromPrincipal(principal));
  }

  @Put('approvers')
  @RequirePermissions(PERMISSION.payrollApprove)
  @ApiOperation({ summary: 'Managing Partner: name the one alternate approver' })
  @HttpCode(204)
  setAlternate(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: AddApproverDto,
  ): Promise<void> {
    return this.payroll.setAlternate(rlsContextFromPrincipal(principal), dto.userId);
  }

  @Delete('approvers')
  @RequirePermissions(PERMISSION.payrollApprove)
  @HttpCode(204)
  clearAlternate(@CurrentPrincipal() principal: Principal): Promise<void> {
    return this.payroll.setAlternate(rlsContextFromPrincipal(principal), null);
  }

  // ── Structures ─────────────────────────────────────────────────────────

  @Get('roster')
  @ApiOperation({ summary: 'Everyone on the rolls with their current pay' })
  roster(@CurrentPrincipal() principal: Principal): Promise<PayRosterRow[]> {
    return this.payroll.roster(rlsContextFromPrincipal(principal));
  }

  @Get('structures')
  structures(
    @CurrentPrincipal() principal: Principal,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ): Promise<SalaryStructure[]> {
    return this.payroll.structures(rlsContextFromPrincipal(principal), {
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Post('structures')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'HR proposes a structure or a revision' })
  propose(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ProposeStructureDto,
  ): Promise<SalaryStructure> {
    return this.payroll.propose(rlsContextFromPrincipal(principal), dto);
  }

  @Post('structures/:id/decision')
  @ApiOperation({ summary: 'The Managing Partner or the alternate approves or rejects' })
  decideStructure(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideDto,
  ): Promise<SalaryStructure> {
    return this.payroll.decideStructure(
      rlsContextFromPrincipal(principal),
      id,
      dto.decision,
      dto.note,
    );
  }

  // ── Bank and statutory numbers ─────────────────────────────────────────

  @Get('employees/:employeeId/pay-details')
  payDetails(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<EmployeePayDetails> {
    return this.payroll.payDetails(rlsContextFromPrincipal(principal), employeeId);
  }

  @Put('employees/:employeeId/pay-details')
  @RequirePermissions(PERMISSION.payrollPrepare)
  setPayDetails(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: PayDetailsDto,
  ): Promise<EmployeePayDetails> {
    return this.payroll.setPayDetails(rlsContextFromPrincipal(principal), employeeId, dto);
  }

  @Post('employees/:employeeId/pay-details/reveal')
  @ApiOperation({ summary: 'Show a full account number or PAN (audited)' })
  reveal(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: RevealDto,
  ): Promise<{ value: string }> {
    return this.payroll.reveal(rlsContextFromPrincipal(principal), employeeId, dto.field);
  }

  @Get('bank-changes')
  bankChanges(
    @CurrentPrincipal() principal: Principal,
    @Query('status') status?: string,
  ): Promise<BankChangeRequest[]> {
    return this.payroll.bankChanges(rlsContextFromPrincipal(principal), status);
  }

  @Post('bank-changes/:id/decision')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'HR verifies (with the person) or rejects a bank change' })
  decideBankChange(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideBankChangeDto,
  ): Promise<BankChangeRequest> {
    return this.payroll.decideBankChange(
      rlsContextFromPrincipal(principal),
      id,
      dto.decision,
      dto.reason,
    );
  }

  // ── Monthly inputs ─────────────────────────────────────────────────────

  @Get('inputs/:month')
  inputs(
    @CurrentPrincipal() principal: Principal,
    @Param() p: MonthParamDto,
  ): Promise<PayrollMonthInputs[]> {
    return this.payroll.inputs(rlsContextFromPrincipal(principal), p.month);
  }

  @Put('inputs/:month/:employeeId')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @HttpCode(204)
  setInputs(
    @CurrentPrincipal() principal: Principal,
    @Param() p: MonthEmployeeParamDto,
    @Body() dto: SetInputsDto,
  ): Promise<void> {
    return this.payroll.setInputs(
      rlsContextFromPrincipal(principal),
      p.month,
      p.employeeId,
      dto.lossOfPayDays,
      dto.inputs,
    );
  }

  // ── Runs ───────────────────────────────────────────────────────────────

  @Get('runs')
  listRuns(@CurrentPrincipal() principal: Principal): Promise<PayrollRunSummary[]> {
    return this.runs.list(rlsContextFromPrincipal(principal));
  }

  @Get('runs/totals')
  @RequireAnyPermission(PERMISSION.payrollReadSummary, PERMISSION.payrollRead)
  @ApiOperation({
    summary: 'The Accountant’s “Payroll to book” feed: totals of approved and paid runs',
  })
  totalsFeed(@CurrentPrincipal() principal: Principal): Promise<PayrollRunTotals[]> {
    return this.runs.totalsFeed(rlsContextFromPrincipal(principal));
  }

  @Post('runs')
  @RequirePermissions(PERMISSION.payrollPrepare)
  createRun(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateRunDto,
  ): Promise<PayrollRunSummary> {
    return this.runs.create(rlsContextFromPrincipal(principal), dto.month, dto.kind);
  }

  @Get('runs/:id')
  run(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PayrollRunDetail> {
    return this.runs.detail(rlsContextFromPrincipal(principal), id);
  }

  @Delete('runs/:id')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @HttpCode(204)
  deleteRun(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.runs.remove(rlsContextFromPrincipal(principal), id);
  }

  @Post('runs/:id/compute')
  @RequirePermissions(PERMISSION.payrollPrepare)
  compute(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VersionDto,
  ): Promise<PayrollRunDetail> {
    return this.runs.compute(rlsContextFromPrincipal(principal), id, dto.version);
  }

  @Post('runs/:id/submit')
  @RequirePermissions(PERMISSION.payrollPrepare)
  submit(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VersionDto,
  ): Promise<PayrollRunSummary> {
    return this.runs.transition(rlsContextFromPrincipal(principal), id, dto.version, 'submitted');
  }

  @Post('runs/:id/approve')
  @ApiOperation({ summary: 'The Managing Partner or the alternate approves (never the preparer)' })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VersionDto,
  ): Promise<PayrollRunSummary> {
    return this.runs.transition(rlsContextFromPrincipal(principal), id, dto.version, 'approved');
  }

  @Post('runs/:id/return')
  @ApiOperation({ summary: 'Send the run back to HR with a reason' })
  returnRun(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReturnRunDto,
  ): Promise<PayrollRunSummary> {
    return this.runs.transition(
      rlsContextFromPrincipal(principal),
      id,
      dto.version,
      'returned',
      dto.reason,
    );
  }

  @Get('runs/:id/bank-file')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'The bulk-transfer CSV for the bank (audited)' })
  async bankFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StreamableFile> {
    const f = await this.runs.bankFile(rlsContextFromPrincipal(principal), id);
    return new StreamableFile(f.data, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${f.filename}"`,
    });
  }

  @Post('runs/:id/paid')
  @RequirePermissions(PERMISSION.payrollPrepare)
  markPaid(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarkPaidDto,
  ): Promise<PayrollRunSummary> {
    return this.runs.markPaid(
      rlsContextFromPrincipal(principal),
      id,
      dto.version,
      dto.bankReference,
    );
  }

  @Post('runs/:id/release')
  @RequirePermissions(PERMISSION.payrollPrepare)
  @ApiOperation({ summary: 'Release payslips to each person' })
  release(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VersionDto,
  ): Promise<PayrollRunSummary> {
    return this.runs.release(rlsContextFromPrincipal(principal), id, dto.version);
  }

  @Post('runs/:id/lock')
  @RequirePermissions(PERMISSION.payrollPrepare)
  lock(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VersionDto,
  ): Promise<PayrollRunSummary> {
    return this.runs.transition(rlsContextFromPrincipal(principal), id, dto.version, 'locked');
  }

  @Get('runs/:id/register.xlsx')
  @ApiOperation({ summary: 'The pay register (audited)' })
  async register(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StreamableFile> {
    const f = await this.runs.register(rlsContextFromPrincipal(principal), id);
    return new StreamableFile(f.data, {
      type: xlsx,
      disposition: `attachment; filename="${f.filename}"`,
    });
  }

  @Get('runs/:id/lines/:employeeId/payslip')
  payslip(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<Payslip> {
    return this.runs.payslip(rlsContextFromPrincipal(principal), id, employeeId);
  }

  @Get('runs/:id/lines/:employeeId/payslip.pdf')
  async payslipPdf(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<StreamableFile> {
    const f = await this.runs.payslipPdf(rlsContextFromPrincipal(principal), id, employeeId);
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `inline; filename="${f.filename}"`,
    });
  }

  // ── The Accountant's view ──────────────────────────────────────────────

  @Get('runs/:id/totals')
  @RequireAnyPermission(PERMISSION.payrollReadSummary, PERMISSION.payrollRead)
  @ApiOperation({ summary: 'Totals by head — no person in them' })
  totals(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PayrollRunTotals> {
    return this.runs.totals(rlsContextFromPrincipal(principal), id);
  }

  @Get('runs/:id/journal')
  @RequireAnyPermission(PERMISSION.payrollReadSummary, PERMISSION.payrollRead)
  @ApiOperation({ summary: 'The balanced journal entry to book the run' })
  journal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PayrollJournal> {
    return this.runs.journal(rlsContextFromPrincipal(principal), id);
  }

  @Get('statutory/:month')
  @ApiOperation({ summary: 'PF, ESI, PT and TDS for a month, with due dates and challans' })
  statutory(
    @CurrentPrincipal() principal: Principal,
    @Param() p: MonthParamDto,
  ): Promise<StatutoryWorking[]> {
    return this.runs.statutory(rlsContextFromPrincipal(principal), p.month);
  }

  @Put('statutory/:month/:kind')
  @RequireAnyPermission(PERMISSION.payrollReadSummary, PERMISSION.payrollApprove)
  @ApiOperation({ summary: 'The Accountant records the challan once deposited' })
  recordChallan(
    @CurrentPrincipal() principal: Principal,
    @Param() p: StatutoryKindParamDto,
    @Body() dto: RecordChallanDto,
  ): Promise<StatutoryWorking[]> {
    return this.runs.recordChallan(rlsContextFromPrincipal(principal), p.month, p.kind, dto);
  }
}
