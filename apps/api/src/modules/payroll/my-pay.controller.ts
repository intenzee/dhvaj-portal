import { Body, Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type BankChangeRequest,
  type EmployeePayDetails,
  type Payslip,
  type PayslipSummary,
  type SalaryStructure,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PayrollRunsService } from './payroll-runs.service';
import { BankChangeDto } from './payroll.dto';
import { PayrollService } from './payroll.service';

/** A person's own pay: structure, numbers (masked), payslips once released, bank change. */
@ApiTags('payroll')
@Controller('me/pay')
@RequirePermissions(PERMISSION.payrollReadOwn)
export class MyPayController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly runs: PayrollRunsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'My approved structures, bank details (masked) and bank-change requests',
  })
  own(@CurrentPrincipal() principal: Principal): Promise<{
    structures: SalaryStructure[];
    payDetails: EmployeePayDetails;
    bankChanges: BankChangeRequest[];
  }> {
    return this.payroll.own(rlsContextFromPrincipal(principal));
  }

  @Get('payslips')
  payslips(@CurrentPrincipal() principal: Principal): Promise<PayslipSummary[]> {
    return this.runs.ownPayslips(rlsContextFromPrincipal(principal));
  }

  @Get('payslips/:runId')
  payslip(
    @CurrentPrincipal() principal: Principal,
    @Param('runId', new ParseUUIDPipe()) runId: string,
  ): Promise<Payslip> {
    return this.runs.payslip(rlsContextFromPrincipal(principal), runId);
  }

  @Get('payslips/:runId/pdf')
  async payslipPdf(
    @CurrentPrincipal() principal: Principal,
    @Param('runId', new ParseUUIDPipe()) runId: string,
  ): Promise<StreamableFile> {
    const f = await this.runs.payslipPdf(rlsContextFromPrincipal(principal), runId);
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `inline; filename="${f.filename}"`,
    });
  }

  @Post('bank-change')
  @ApiOperation({ summary: 'Ask to be paid into another account (HR verifies it)' })
  requestBankChange(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: BankChangeDto,
  ): Promise<BankChangeRequest> {
    return this.payroll.requestBankChange(rlsContextFromPrincipal(principal), dto);
  }
}
